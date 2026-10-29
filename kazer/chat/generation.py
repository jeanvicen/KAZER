"""Gerações em andamento, desacopladas da conexão de quem perguntou.

A resposta roda numa thread própria e é gravada no banco aos poucos. A conexão
HTTP só acompanha os eventos: se a rede cair, a geração continua e o navegador
pode reatar do ponto em que parou (ou ler o resultado final do banco).
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    ModelProvider,
    ProviderError,
)
from kazer.chat.store import ChatStore

logger = logging.getLogger("kazer.chat")

HEARTBEAT_SECONDS = 15.0


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


class GenerationHub:
    """Executa gerações com limite global de concorrência e prazo máximo."""

    def __init__(
        self,
        store: ChatStore,
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
        self, user_id: str, conversation_id: str, reply_id: str, request: GenerationRequest
    ) -> LiveGeneration:
        """Inicia a geração numa vaga já reservada com `try_reserve()`."""
        live = LiveGeneration(reply_id, user_id, conversation_id)
        with self._lock:
            self._evict()
            self._live[reply_id] = live
        thread = threading.Thread(
            target=self._run, args=(live, request), name="kazer-generation", daemon=True
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

    def _run(self, live: LiveGeneration, request: GenerationRequest) -> None:
        text: list[str] = []
        thinking: list[str] = []
        status, error, stop = "complete", None, "end"
        last_save = time.monotonic()

        def expire() -> None:
            live.timed_out = True
            live.cancel.cancel()

        watchdog = threading.Timer(self._max_seconds, expire)
        watchdog.daemon = True
        watchdog.start()
        try:
            for event in self._provider.stream(request, live.cancel):
                if live.cancel.cancelled():
                    break
                if event.kind == "text":
                    text.append(event.text)
                    live.push({"type": "delta", "text": event.text})
                elif event.kind == "thinking":
                    thinking.append(event.text)
                    live.push({"type": "thinking", "text": event.text})
                elif event.kind == "searching":
                    live.push({"type": "searching"})
                elif event.kind == "stop":
                    stop = event.text
                if time.monotonic() - last_save >= self._persist_every:
                    last_save = time.monotonic()
                    self._store.update_reply(
                        live.reply_id, content="".join(text), thinking="".join(thinking)
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
            live.push({"type": "done", "reply": reply}, final=True)
            with self._lock:
                self._finished_at[live.reply_id] = time.monotonic()
            self._slots.release()
            logger.info("chat.generation_finished", extra={"status": status, "error": error})
