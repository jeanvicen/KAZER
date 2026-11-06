"""Gerações em andamento, desacopladas da conexão de quem perguntou.

A resposta roda numa thread própria e é gravada no banco aos poucos. A conexão
HTTP só acompanha os eventos: se a rede cair, a geração continua e o navegador
pode reatar do ponto em que parou (ou ler o resultado final do banco).
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections.abc import AsyncIterator, Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from typing import Any

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    ModelProvider,
    Part,
    ProviderError,
    ToolCall,
    Turn,
)
from kazer.chat import prefetch as pre
from kazer.chat import web_tools as wt
from kazer.chat.identity import bind_access_token
from kazer.chat.protocols import ChatStorage

logger = logging.getLogger("kazer.chat")

HEARTBEAT_SECONDS = 15.0
# Quantas rodadas de ferramenta uma resposta pode dar antes de parar.
# Sem teto, um modelo preso num laço gastaria a cota da pessoa à toa.
MAX_TOOL_ROUNDS = 4
# Resultados de ferramenta de rodadas anteriores voltam encurtados: o modelo já
# leu e resumiu; reenviar tudo a cada rodada estourava o limite do provedor.
OLD_RESULT_CHARS = 1500
STEPS_FENCE = "kazer-passos"
FINAL_ROUND = (
    "[KAZER: o orçamento de pesquisa desta resposta acabou. Responda agora, completo e"
    " organizado, com o que já foi encontrado e cite as fontes. Não peça mais ferramentas.]"
)
# Fontes que a resposta consultou vão no fim do texto, num bloco que a interface
# transforma em chips (e que nunca volta ao modelo como histórico).
SOURCES_FENCE = "kazer-fontes"
MAX_SOURCES = 60
# Quando o provedor corta por tamanho, o KAZER pede para continuar de onde parou
# (no máximo estas vezes), em vez de entregar um arquivo pela metade.
MAX_CONTINUATIONS = 3
IMAGES_FENCE = "kazer-imagens"
MAX_IMAGES = 8
# Quanto esperar o modelo leve decidir se vale pesquisar (depois disso, pesquisa).
DECIDE_SECONDS = 4.0
CONTINUE_PROMPT = (
    "Continue exatamente de onde a resposta parou, sem repetir nada e sem comentar"
    " a interrupção. Se estava dentro de um bloco de código, continue o código."
)


@dataclass
class LiveGeneration:
    """Estado compartilhado entre a thread do modelo e os ouvintes assíncronos."""

    reply_id: str
    user_id: str
    conversation_id: str
    cancel: CancelToken = field(default_factory=CancelToken)
    events: list[dict[str, Any]] = field(default_factory=list)
    done: bool = False
    timed_out: bool = False
    # Chamado depois da resposta pronta (por exemplo, para dar nome à conversa).
    on_complete: Callable[[LiveGeneration, str], None] | None = None
    # Executa uma ferramenta; devolve (rótulo, texto) ou (rótulo, texto, fontes, detalhe).
    on_tool: Callable[[ToolCall], tuple[Any, ...]] | None = None
    # Rótulo do passo antes de a ferramenta rodar (para a tela mostrar "fazendo agora").
    describe: Callable[[ToolCall], str] | None = None
    # Fontes consultadas nesta resposta (título, endereço, tipo), sem repetição.
    sources: list[dict[str, str]] = field(default_factory=list)
    # Passos concluídos (rótulo e detalhe), salvos junto da resposta.
    steps: list[dict[str, str]] = field(default_factory=list)
    # Fotos da web achadas na pesquisa: a interface mostra no topo da resposta.
    images: list[dict[str, str]] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _waiters: set[tuple[asyncio.AbstractEventLoop, asyncio.Event]] = field(default_factory=set)

    def push(self, event: dict[str, Any], *, final: bool = False) -> None:
        """Acrescenta um evento (só cresce) e acorda quem estiver ouvindo."""
        with self._lock:
            event["i"] = len(self.events)
            self.events.append(event)
            if final:
                self.done = True
            waiters = list(self._waiters)
        for loop, waiter in waiters:
            try:
                loop.call_soon_threadsafe(waiter.set)
            except RuntimeError:
                pass  # loop já encerrado

    async def follow(self, after: int = -1) -> AsyncIterator[dict[str, Any]]:
        """Eventos com índice maior que `after`, em ordem; pings quando quieto."""
        index = after + 1
        loop = asyncio.get_running_loop()
        while True:
            waiter = asyncio.Event()
            entry = (loop, waiter)
            with self._lock:
                self._waiters.add(entry)
                batch = self.events[index:]
                done = self.done
            try:
                if batch:
                    index += len(batch)
                    for event in batch:
                        yield event
                    continue
                if done:
                    return
                try:
                    await asyncio.wait_for(waiter.wait(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield {"type": "ping"}
            finally:
                with self._lock:
                    self._waiters.discard(entry)


def _compact(turns: tuple[Turn, ...]) -> tuple[Turn, ...]:
    """Encurta resultados de ferramenta já usados (o modelo já os leu)."""
    out = []
    for turn in turns:
        if turn.results:
            short = tuple(
                (call_id, output if len(output) <= OLD_RESULT_CHARS
                 else output[:OLD_RESULT_CHARS] + "\n[…resumido: já lido na rodada anterior]")
                for call_id, output in turn.results
            )
            out.append(replace(turn, results=short))
        else:
            out.append(turn)
    return tuple(out)


class GenerationHub:
    """Executa gerações com limite global de concorrência e prazo máximo."""

    def __init__(
        self,
        store: ChatStorage,
        provider: ModelProvider,
        *,
        max_concurrent: int = 16,
        max_seconds: float = 600.0,
        persist_every: float = 1.0,
        keep_finished: float = 120.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        """`keep_finished`: por quanto tempo uma geração encerrada aceita reconexão."""
        self._store = store
        self._provider = provider
        self._slots = threading.BoundedSemaphore(max_concurrent)
        self._max_seconds = max_seconds
        self._persist_every = persist_every
        self._keep_finished = keep_finished
        self._clock = clock
        self._live: dict[str, LiveGeneration] = {}
        self._finished_at: dict[str, float] = {}
        self._lock = threading.Lock()

    def _evict(self) -> None:
        now = time.monotonic()
        for reply_id, ended in list(self._finished_at.items()):
            if now - ended > self._keep_finished:
                self._finished_at.pop(reply_id, None)
                self._live.pop(reply_id, None)

    def get(self, user_id: str, reply_id: str) -> LiveGeneration | None:
        """Geração ativa (ou recém-encerrada) da própria conta."""
        with self._lock:
            self._evict()
            live = self._live.get(reply_id)
        return live if live is not None and live.user_id == user_id else None

    def busy(self, conversation_id: str) -> bool:
        """Já existe resposta sendo gerada nesta conversa."""
        with self._lock:
            return any(
                live.conversation_id == conversation_id and not live.done
                for live in self._live.values()
            )

    def try_reserve(self) -> bool:
        """Reserva vaga de execução; False quando o servidor está no limite."""
        return self._slots.acquire(blocking=False)

    def release(self) -> None:
        """Devolve uma vaga reservada e não usada."""
        self._slots.release()

    def start(
        self,
        user_id: str,
        conversation_id: str,
        reply_id: str,
        request: GenerationRequest,
        access_token: str | None = None,
        on_complete: Callable[[LiveGeneration, str], None] | None = None,
        on_tool: Callable[[ToolCall], tuple[Any, ...]] | None = None,
        describe: Callable[[ToolCall], str] | None = None,
    ) -> LiveGeneration:
        """Inicia a geração numa vaga já reservada com `try_reserve()`.

        `on_tool` executa uma ferramenta de conector e devolve (rótulo, texto).
        """
        live = LiveGeneration(reply_id, user_id, conversation_id)
        live.on_complete = on_complete
        live.on_tool = on_tool
        live.describe = describe
        with self._lock:
            self._evict()
            self._live[reply_id] = live
        thread = threading.Thread(
            target=self._run,
            args=(live, request, access_token),
            name="kazer-generation",
            daemon=True,
        )
        thread.start()
        return live

    def cancel(self, user_id: str, reply_id: str) -> bool:
        """Interrompe a geração a pedido da própria conta."""
        live = self.get(user_id, reply_id)
        if live is None or live.done:
            return False
        live.cancel.cancel()
        return True

    def shutdown(self) -> None:
        """Encerramento do servidor: interrompe tudo (o banco marca como interrompido)."""
        with self._lock:
            lives = list(self._live.values())
        for live in lives:
            live.cancel.cancel()

    def _run(
        self, live: LiveGeneration, request: GenerationRequest, access_token: str | None = None
    ) -> None:
        # A thread roda fora da requisição: o token vai explícito (uma thread
        # nova não herda o contexto da requisição).
        with bind_access_token(access_token):
            self._generate(live, request)

    @staticmethod
    def _relay(
        live: LiveGeneration,
        event: Any,
        text: list[str],
        thinking: list[str],
    ) -> None:
        """Um evento do modelo vira um evento da conversa."""
        if event.kind == "text":
            text.append(event.text)
            live.push({"type": "delta", "text": event.text})
        elif event.kind == "thinking":
            thinking.append(event.text)
            live.push({"type": "thinking", "text": event.text})
        elif event.kind == "searching":
            live.push({"type": "searching"})
        elif event.kind == "activity":
            # Narração do que está acontecendo: rótulo curto do servidor,
            # nunca conteúdo externo colado direto.
            live.push({"type": "step", "label": event.text})

    def _after_tools(
        self,
        live: LiveGeneration,
        request: GenerationRequest,
        calls: list[ToolCall],
        round_text: list[str],
    ) -> GenerationRequest:
        """Executa as ferramentas pedidas e devolve o pedido da rodada seguinte.

        O resultado volta ao modelo como resultado de ferramenta — dado vindo de
        fora, nunca instrução do sistema. O histórico só cresce: o pedido e o
        resultado entram no fim, sem reescrever nada do que já foi.
        """
        assert live.on_tool is not None
        results: list[tuple[str, str]] = []
        for call in calls:
            # O passo aparece antes de rodar ("fazendo agora") e é fechado depois,
            # com o que realmente voltou. Nada é narrado sem ter acontecido.
            step_id = f"{call.id or call.name}-{len(live.events)}"
            label = live.describe(call) if live.describe else ""
            if label:
                live.push({"type": "step", "id": step_id, "label": label, "state": "run"})
            outcome = live.on_tool(call)
            label = str(outcome[0]) or label
            output = str(outcome[1])
            found = outcome[2] if len(outcome) > 2 else []
            detail = str(outcome[3]) if len(outcome) > 3 and outcome[3] else ""
            live.push(
                {"type": "step", "id": step_id, "label": label, "state": "done", "detail": detail}
            )
            if label:
                live.steps.append({"l": label[:160], "d": detail[:80]})
            if found:
                self._record(live, found)
            results.append((call.id, output))
        budget = request.tool_rounds or MAX_TOOL_ROUNDS
        used = sum(1 for turn in request.turns if turn.results) + 1
        # O modelo decide se precisa de mais: sabe quanto já usou e quanto resta.
        note = Part(
            "text",
            f"[KAZER: rodada de pesquisa {used} de {budget}. Se o que você já tem responde bem"
            " ao pedido, responda agora. Só pesquise de novo se faltar algo importante, e com"
            " uma busca diferente das anteriores.]",
        )
        return replace(
            request,
            turns=(
                *_compact(request.turns),
                Turn(
                    role="assistant",
                    parts=(Part("text", "".join(round_text)),) if round_text else (),
                    calls=tuple(calls),
                ),
                Turn(role="user", parts=(note,), results=tuple(results)),
            ),
        )

    def _record(self, live: LiveGeneration, found: Sequence[dict[str, str]]) -> None:
        pictures = [item for item in found if item.get("img")]
        if pictures:
            have = {item["url"] for item in live.images}
            for item in pictures:
                if item["img"] not in have and len(live.images) < MAX_IMAGES:
                    have.add(item["img"])
                    live.images.append(
                        {"url": item["img"], "legenda": item.get("t", ""), "fonte": item["u"]}
                    )
            live.push({"type": "images", "items": list(live.images)})
        found = [item for item in found if not item.get("img")]
        known = {item["u"] for item in live.sources}
        fresh = [item for item in found if item.get("u") and item["u"] not in known]
        if fresh:
            live.sources.extend(fresh[: MAX_SOURCES - len(live.sources)])
            live.push({"type": "sources", "items": list(live.sources)})

    def _run_parallel(
        self, live: LiveGeneration, calls: Sequence[ToolCall]
    ) -> list[tuple[str, str, list[dict[str, str]]]]:
        """Roda várias buscas ao mesmo tempo, mostrando cada passo de verdade."""
        assert live.on_tool is not None
        on_tool = live.on_tool
        ids = [f"{call.id}-{len(live.events)}-{n}" for n, call in enumerate(calls)]
        for step_id, call in zip(ids, calls, strict=True):
            label = live.describe(call) if live.describe else ""
            if label:
                live.push({"type": "step", "id": step_id, "label": label, "state": "run"})
        with ThreadPoolExecutor(max_workers=min(4, len(calls))) as pool:
            outcomes = list(pool.map(on_tool, calls))
        results = []
        for step_id, outcome in zip(ids, outcomes, strict=True):
            label = str(outcome[0])
            output = str(outcome[1])
            found = list(outcome[2]) if len(outcome) > 2 else []
            detail = str(outcome[3]) if len(outcome) > 3 and outcome[3] else ""
            live.push(
                {"type": "step", "id": step_id, "label": label, "state": "done", "detail": detail}
            )
            if label:
                live.steps.append({"l": label[:160], "d": detail[:80]})
            self._record(live, found)
            results.append((label, output, found))
        return results

    def _worth_searching(self, question: str) -> bool:
        """Caso duvidoso: o modelo leve diz SIM ou NAO (na dúvida, pesquisa)."""
        token = CancelToken()
        decide = GenerationRequest(
            system=pre.DECIDE_PROMPT,
            turns=(Turn("user", (Part("text", question),)),),
            light=True,
        )

        def ask() -> str:
            pieces: list[str] = []
            for event in self._provider.stream(decide, token):
                if event.kind == "text":
                    pieces.append(event.text)
                if sum(len(piece) for piece in pieces) > 40:
                    break
            return "".join(pieces)

        pool = ThreadPoolExecutor(max_workers=1)
        try:
            answer = pool.submit(ask).result(timeout=DECIDE_SECONDS)
        except Exception:  # noqa: BLE001 - lento ou fora do ar: pesquisa por garantia
            token.cancel()
            return True
        finally:
            pool.shutdown(wait=False)
        return not answer.strip().upper().startswith("N")

    def _prefetch(self, live: LiveGeneration, request: GenerationRequest) -> GenerationRequest:
        """Pesquisa antes do modelo: busca, lê as melhores páginas e junta à pergunta.

        A Groq recebe tudo pronto e só escreve — sem chamar ferramenta nenhuma.
        """
        if request.prefetch_check and not self._worth_searching(request.prefetch_check):
            return replace(request, prefetch=(), prefetch_check="")
        first = self._run_parallel(live, request.prefetch)
        opened = {
            str(call.arguments.get("url", "")) for call in request.prefetch if call.name == wt.OPEN
        }
        found = [item for _, _, items in first for item in items]
        pages = [] if live.cancel.cancelled() else pre.pages_to_open(found, opened)
        second = (
            self._run_parallel(
                live,
                [ToolCall(f"pre-page-{n}", wt.OPEN, {"url": url}) for n, url in enumerate(pages)],
            )
            if pages
            else []
        )
        results = [(label, output) for label, output, _ in (*first, *second)]
        note = Part("text", pre.context_note(results))
        last = request.turns[-1]
        return replace(
            request,
            prefetch=(),
            prefetch_check="",
            # Só falta escrever com o que veio: pensar pouco economiza cota.
            brief=True,
            turns=(*request.turns[:-1], replace(last, parts=(*last.parts, note))),
        )

    def _generate(self, live: LiveGeneration, request: GenerationRequest) -> None:
        text: list[str] = []
        thinking: list[str] = []
        status, error, stop = "complete", None, "end"
        last_save = time.monotonic()
        rounds = 0
        continuations = 0

        def expire() -> None:
            live.timed_out = True
            live.cancel.cancel()

        watchdog = threading.Timer(self._max_seconds, expire)
        watchdog.daemon = True
        watchdog.start()
        try:
            if request.prefetch:
                if live.on_tool is not None:
                    try:
                        request = self._prefetch(live, request)
                    except Exception:  # noqa: BLE001 - busca falhou: responde sem ela
                        logger.warning("chat.prefetch_failed")
                        request = replace(request, prefetch=())
                else:
                    request = replace(request, prefetch=())
            while True:
                calls: list[ToolCall] = []
                round_text: list[str] = []
                for event in self._provider.stream(request, live.cancel):
                    if live.cancel.cancelled():
                        break
                    if event.kind == "tool" and event.call is not None:
                        calls.append(event.call)
                        continue
                    if event.kind == "text":
                        round_text.append(event.text)
                    self._relay(live, event, text, thinking)
                    if time.monotonic() - last_save >= self._persist_every:
                        last_save = time.monotonic()
                        self._store.update_reply(
                            live.reply_id,
                            content="".join(text),
                            thinking="".join(thinking),
                            user_id=live.user_id,
                        )
                    if event.kind == "stop":
                        stop = event.text
                if live.cancel.cancelled():
                    break
                if (
                    not calls
                    and stop == "length"
                    and not round_text
                    and not request.brief
                    and continuations < MAX_CONTINUATIONS
                ):
                    # O raciocínio gastou todo o espaço e não sobrou resposta:
                    # tenta de novo pensando pouco (em vez de mostrar erro).
                    continuations += 1
                    stop = "end"
                    request = replace(request, brief=True)
                    continue
                cut = not calls and stop == "length" and bool(round_text)
                if cut and continuations < MAX_CONTINUATIONS:
                    # Cortou por tamanho: a mesma resposta continua na rodada seguinte.
                    continuations += 1
                    stop = "end"
                    live.push({"type": "step", "label": "Continuando a resposta"})
                    request = replace(
                        request,
                        turns=(
                            *request.turns,
                            Turn("assistant", (Part("text", "".join(round_text)),)),
                            Turn("user", (Part("text", CONTINUE_PROMPT),)),
                        ),
                    )
                    continue
                if not calls or live.on_tool is None:
                    break
                rounds += 1
                request = self._after_tools(live, request, calls, round_text)
                if rounds >= (request.tool_rounds or MAX_TOOL_ROUNDS):
                    # Orçamento esgotado: uma última rodada sem ferramentas, para ele
                    # responder com o que achou (em vez de parar sem resposta).
                    last = request.turns[-1]
                    request = replace(
                        request,
                        tool_choice="none",
                        turns=(
                            *request.turns[:-1],
                            replace(last, parts=(Part("text", FINAL_ROUND),)),
                        ),
                    )
            if live.timed_out:
                status, error = "error", "model_timeout"
            elif live.cancel.cancelled():
                status = "stopped"
            elif stop == "refusal":
                # Recusa (inclusive no meio do stream): a parte já gerada é descartada.
                status, error, text = "error", "model_refused", []
            elif not "".join(text).strip():
                status, error = "error", "model_empty"
        except ProviderError as exc:
            status, error = "error", exc.code
        except Exception:  # noqa: BLE001 - nunca derrubar o servidor nem vazar detalhes
            logger.exception("chat.generation_crashed")
            status, error = "error", "model_error"
        finally:
            watchdog.cancel()
            content, reasoning = "".join(text), "".join(thinking)
            # O que foi pesquisado fica salvo na conversa, mesmo se a resposta falhar.
            if error != "model_refused" and (live.sources or live.steps or live.images):
                blocks = []
                if live.images:
                    blocks.append(
                        f"```{IMAGES_FENCE}\n{json.dumps(live.images, ensure_ascii=False)}\n```"
                    )
                if live.sources:
                    blocks.append(
                        f"```{SOURCES_FENCE}\n{json.dumps(live.sources, ensure_ascii=False)}\n```"
                    )
                if live.steps:
                    blocks.append(
                        f"```{STEPS_FENCE}\n{json.dumps(live.steps[:80], ensure_ascii=False)}\n```"
                    )
                content = (content.rstrip() + "\n\n" + "\n\n".join(blocks) + "\n").lstrip()
            finished = int(self._clock())
            try:
                self._store.update_reply(
                    live.reply_id,
                    content=content,
                    thinking=reasoning,
                    status=status,
                    error_code=error,
                    stop_reason=stop if status == "complete" else None,
                    finished_at=finished,
                    user_id=live.user_id,
                )
            except Exception:  # noqa: BLE001
                logger.exception("chat.persist_failed")
            reply = {
                "id": live.reply_id,
                "status": status,
                "error": error,
                "stop": stop if status == "complete" else None,
                "content": content,
                "thinking": reasoning,
                "finished_at": finished,
            }
            if status == "complete" and content and live.on_complete is not None:
                try:
                    live.on_complete(live, content)
                except Exception:  # noqa: BLE001 - trabalho extra não derruba a resposta
                    logger.exception("chat.on_complete_failed")
            live.push({"type": "done", "reply": reply}, final=True)
            with self._lock:
                self._finished_at[live.reply_id] = time.monotonic()
            self._slots.release()
            logger.info("chat.generation_finished", extra={"status": status, "error": error})
