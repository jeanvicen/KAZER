"""Adaptadores de modelo: o "KAZ 1.1" público mapeado para o provedor configurado.

O navegador só conhece `KAZ 1.1`. Qual provedor, qual modelo e qual chave atendem
esse nome é decisão do servidor (variáveis de ambiente). As chaves são lidas pelo
módulo de segredos com allowlist, ficam só na memória do adaptador e nunca aparecem
em logs, respostas, mensagens de erro ou `repr`.

Dois caminhos cobrem quase todo o mercado:
- API compatível com OpenAI (xAI/Grok, OpenAI, Gemini, Groq, DeepSeek, Mistral,
  OpenRouter, Together, Ollama ou qualquer URL própria), só com a biblioteca padrão;
- Anthropic (Claude), pelo SDK oficial, instalado como extra opcional.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import ssl
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast
from urllib.parse import urlsplit

from kazer.brain.groq_limits import (
    GOVERNOR,
    MIN_OUTPUT,
    estimate_tokens,
    too_large_numbers,
)
from kazer.config.settings import Settings
from kazer.security.secrets import EnvironmentSecretProvider, SecretProvider

logger = logging.getLogger("kazer.model")

PUBLIC_MODEL_ID = "kaz-1.1"
PUBLIC_MODEL_LABEL = "KAZ 1.1"
# Níveis de esforço que o navegador pode pedir; o servidor rejeita qualquer outro
# valor. Cada provedor decide o que cada nível significa (a Groq, por exemplo,
# troca de modelo); quem não sabe diferenciar anuncia só o "baixo".
EFFORTS = {"baixo": "low", "medio": "medium", "alto": "high", "extra": "xhigh", "max": "max"}


@dataclass(frozen=True, slots=True)
class Capabilities:
    """O que o modelo configurado realmente suporta (a interface só mostra isso)."""

    deep: bool = False
    images: bool = False
    documents: bool = False
    web_search: bool = False
    # Níveis de esforço que este provedor realmente diferencia.
    efforts: tuple[str, ...] = ("baixo",)


@dataclass(frozen=True, slots=True)
class Part:
    """Pedaço de uma mensagem enviada ao modelo."""

    kind: Literal["text", "image", "document"]
    text: str = ""
    media_type: str = ""
    data: bytes = b""


@dataclass(frozen=True, slots=True)
class ToolDef:
    """Ferramenta de conector oferecida ao modelo nesta resposta."""

    name: str
    description: str
    schema: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ToolCall:
    """Pedido do modelo para usar uma ferramenta."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Turn:
    """Uma fala do histórico, já filtrada e pertencente ao dono da conversa.

    `calls` e `results` só existem no meio de um ciclo de ferramentas: o modelo
    pede, o KAZER executa, e a volta carrega o resultado.
    """

    role: Literal["user", "assistant"]
    parts: tuple[Part, ...]
    calls: tuple[ToolCall, ...] = ()
    results: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    """Pedido validado: o adaptador nunca recebe valores vindos direto do navegador."""

    system: str
    turns: tuple[Turn, ...]
    effort: str = "low"
    deep: bool = False
    web_search: bool = False
    tools: tuple[ToolDef, ...] = ()
    # Quantas rodadas de ferramenta esta resposta pode dar (0 = padrão do hub).
    tool_rounds: int = 0
    # "none": as ferramentas continuam declaradas, mas o modelo deve só responder.
    tool_choice: str = ""
    # Tarefa de bastidor (título da conversa): modelo leve, resposta curta.
    light: bool = False


@dataclass(frozen=True, slots=True)
class StreamEvent:
    """Evento incremental: texto, resumo de raciocínio, busca ou fim (com motivo)."""

    kind: Literal["text", "thinking", "searching", "activity", "tool", "stop"]
    text: str = ""
    # Só no evento "tool": o que o modelo quer executar.
    call: ToolCall | None = None


class ProviderError(Exception):
    """Falha do provedor com código estável; nunca carrega corpo, chave ou conteúdo."""

    def __init__(self, code: str, retry_after: float = 0.0) -> None:
        """Códigos: model_auth, model_busy, model_timeout, model_unreachable,
        model_rejected, model_error."""
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


class CancelToken:
    """Cancelamento cooperativo entre a requisição web e a thread de geração."""

    def __init__(self) -> None:
        """Começa ativo; `cancel()` dispara os callbacks registrados uma única vez."""
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._callbacks: list[Callable[[], object]] = []

    def cancel(self) -> None:
        """Marca como cancelado e fecha conexões abertas pelo adaptador."""
        with self._lock:
            if self._event.is_set():
                return
            self._event.set()
            callbacks, self._callbacks = self._callbacks, []
        for callback in callbacks:
            try:
                callback()
            except Exception:  # noqa: BLE001 - fechar conexão já encerrada é inofensivo
                pass

    def cancelled(self) -> bool:
        """Indica se a geração deve parar."""
        return self._event.is_set()

    def on_cancel(self, callback: Callable[[], object]) -> None:
        """Registra limpeza; roda na hora se o cancelamento já aconteceu."""
        with self._lock:
            if not self._event.is_set():
                self._callbacks.append(callback)
                return
        callback()


class ModelProvider(Protocol):
    """Contrato único que o chat usa, independente de quem atende o KAZ 1.1."""

    capabilities: Capabilities

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Gera a resposta em partes; lança `ProviderError` em falhas."""
        ...


# ---------------------------------------------------------------------------
# Provedores compatíveis com a API de chat da OpenAI
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Preset:
    base_url: str
    secret: str | None
    vision: bool


_PRESETS: dict[str, _Preset] = {
    "xai": _Preset("https://api.x.ai/v1", "XAI_API_KEY", True),
    "openai": _Preset("https://api.openai.com/v1", "OPENAI_API_KEY", True),
    "gemini": _Preset(
        "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY", True
    ),
    "groq": _Preset("https://api.groq.com/openai/v1", "GROQ_API_KEY", False),
    "deepseek": _Preset("https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", False),
    "mistral": _Preset("https://api.mistral.ai/v1", "MISTRAL_API_KEY", False),
    "openrouter": _Preset("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", True),
    "together": _Preset("https://api.together.xyz/v1", "TOGETHER_API_KEY", False),
    "ollama": _Preset("http://127.0.0.1:11434/v1", None, False),
    "custom": _Preset("", "KAZER_MODEL_API_KEY", False),
}

_FINISH = {"stop": "end", "length": "length", "content_filter": "refusal"}


class ModelGone(ProviderError):
    """O modelo pedido não existe mais no provedor (aposentado ou renomeado)."""


_GONE_CODES = {"model_decommissioned", "model_not_found", "model_not_active"}


def _model_gone(code: int, raw: bytes) -> bool:
    """O erro diz que o modelo sumiu? Lê só o código; o corpo nunca vai ao log."""
    if code == 404:
        return True
    if code != 400:
        return False
    try:
        body = json.loads(raw)
    except ValueError:
        return False
    error = body.get("error") if isinstance(body, dict) else None
    code_name = error.get("code") if isinstance(error, dict) else None
    return isinstance(code_name, str) and code_name in _GONE_CODES


def _status_error(status: int, retry_after: str | None) -> ProviderError:
    if status in (401, 403):
        return ProviderError("model_auth")
    if status == 429:
        try:
            wait = float(retry_after or 0)
        except ValueError:
            wait = 0.0
        return ProviderError("model_busy", retry_after=wait)
    if status in (408, 504):
        return ProviderError("model_timeout")
    if status in (529, 502, 503):
        return ProviderError("model_busy")
    if 400 <= status < 500:
        return ProviderError("model_rejected")
    return ProviderError("model_error")


class _ThinkSplitter:
    """Separa `<think>...</think>` do texto, mesmo com a marca partida entre pedaços.

    Modelos sem raciocínio nativo às vezes pensam por escrito nessas marcas (o
    prompt do KAZER permite). O rascunho vira evento "thinking" e nunca se mistura
    com a resposta.
    """

    _OPEN, _CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self._buffer = ""
        self._inside = False

    def feed(self, chunk: str) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        self._buffer += chunk
        while self._buffer:
            tag = self._CLOSE if self._inside else self._OPEN
            index = self._buffer.find(tag)
            kind = "thinking" if self._inside else "text"
            if index >= 0:
                if index:
                    out.append((kind, self._buffer[:index]))
                self._buffer = self._buffer[index + len(tag) :]
                self._inside = not self._inside
                continue
            # Guarda um possível começo de marca para o próximo pedaço.
            keep = 0
            for size in range(min(len(tag) - 1, len(self._buffer)), 0, -1):
                if tag.startswith(self._buffer[-size:]):
                    keep = size
                    break
            emit = self._buffer[: len(self._buffer) - keep]
            if emit:
                out.append((kind, emit))
            self._buffer = self._buffer[len(self._buffer) - keep :]
            break
        return out

    def flush(self) -> list[tuple[str, str]]:
        rest, self._buffer = self._buffer, ""
        return [("thinking" if self._inside else "text", rest)] if rest else []


def _text_of(turn: Turn) -> str:
    return "\n\n".join(part.text for part in turn.parts if part.kind == "text" and part.text)


class OpenAICompatibleProvider:
    """Streaming SSE em `/chat/completions`, sem dependências externas."""

    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str | None,
        model: str,
        deep_model: str,
        capabilities: Capabilities,
        send_effort: bool,
        max_tokens: int,
        timeout: float,
    ) -> None:
        """Recebe a chave já resolvida pelo módulo de segredos."""
        self._name = name
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._key = api_key
        self._model = model
        self._deep_model = deep_model
        self._send_effort = send_effort
        self._max_tokens = max_tokens
        self._timeout = timeout
        self.capabilities = capabilities
        # Espera máxima (s) antes de tentar de novo quando todos os modelos estão cheios.
        self.busy_wait = 12.0

    def __repr__(self) -> str:
        """Sem chave nem URL completa."""
        return f"OpenAICompatibleProvider(name={self._name!r})"

    def _messages(self, request: GenerationRequest) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": request.system}]
        for turn in request.turns:
            if turn.calls or turn.results:
                messages.extend(self._tool_messages(turn))
                continue
            images = [part for part in turn.parts if part.kind == "image"]
            text = _text_of(turn)
            if not images:
                messages.append({"role": turn.role, "content": text})
                continue
            content: list[dict[str, Any]] = [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{part.media_type};base64,"
                        + base64.b64encode(part.data).decode("ascii")
                    },
                }
                for part in images
            ]
            if text:
                content.append({"type": "text", "text": text})
            messages.append({"role": turn.role, "content": content})
        return messages

    @staticmethod
    def _tool_messages(turn: Turn) -> list[dict[str, Any]]:
        """Pedido e resultado de ferramenta, no formato das Chat Completions."""
        out: list[dict[str, Any]] = []
        if turn.calls:
            out.append(
                {
                    "role": "assistant",
                    "content": _text_of(turn) or None,
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments, ensure_ascii=False),
                            },
                        }
                        for call in turn.calls
                    ],
                }
            )
        out.extend(
            {"role": "tool", "tool_call_id": call_id, "content": output}
            for call_id, output in turn.results
        )
        note = _text_of(turn) if turn.results else ""
        if note:
            out.append({"role": "user", "content": note})
        return out

    def _attempts(self, request: GenerationRequest) -> list[tuple[str, dict[str, Any]]]:
        """Modelos a tentar, em ordem, com os parâmetros próprios de cada um.

        Aqui é só um: o configurado. Quem troca de modelo por esforço (Groq)
        sobrescreve este método e devolve uma cadeia com reserva.
        """
        model = self._deep_model if request.deep and self._deep_model else self._model
        extra: dict[str, Any] = {}
        if self._send_effort:
            # A API da OpenAI só conhece low/medium/high.
            level = "high" if request.deep else request.effort
            extra["reasoning_effort"] = level if level in {"low", "medium", "high"} else "high"
        return [(model, extra)]

    def _body(
        self, request: GenerationRequest, model: str, extra: dict[str, Any]
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": self._messages(request),
            "stream": True,
            **extra,
        }
        if self._max_tokens:
            body["max_tokens"] = self._max_tokens
        if request.tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.schema,
                    },
                }
                for tool in request.tools
            ]
            if request.tool_choice == "none":
                body["tool_choice"] = "none"
        return body

    def _open(self, body: dict[str, Any]) -> Any:
        """Abre a conexão; falha com código estável e sem vazar corpo nem chave."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "User-Agent": "KAZER/0.1",
        }
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        http_request = urllib.request.Request(
            self._url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
        )
        model = str(body.get("model", ""))
        try:
            response = urllib.request.urlopen(http_request, timeout=self._timeout)  # noqa: S310
        except urllib.error.HTTPError as exc:
            raw = b""
            if exc.code in (400, 413, 429):
                try:
                    raw = exc.read(4096)
                except OSError:
                    raw = b""
            gone = _model_gone(exc.code, raw)
            self._observe(model, exc.headers, exc.code)
            sizes = too_large_numbers(raw.decode("utf-8", "replace"))
            exc.close()
            logger.warning(
                "model.http_error",
                extra={"provider": self._name, "status": exc.code, "model_gone": gone},
            )
            if exc.code == 413 or sizes:
                # Pedido maior que o limite por minuto DESTE modelo: outro modelo
                # (ou o mesmo com resposta menor) resolve; esperar não adianta.
                self._too_large(model, sizes)
                raise ProviderError("model_too_large") from None
            error = _status_error(exc.code, exc.headers.get("retry-after"))
            raise ModelGone(error.code, error.retry_after) if gone else error from None
        except TimeoutError:
            raise ProviderError("model_timeout") from None
        except (urllib.error.URLError, ssl.SSLError, OSError):
            logger.warning("model.unreachable", extra={"provider": self._name})
            raise ProviderError("model_unreachable") from None
        self._observe(model, response.headers, response.status)
        return response

    def _observe(self, model: str, headers: Any, status: int) -> None:
        """Ganchos de limite (a Groq usa; o genérico ignora)."""

    def _too_large(self, model: str, sizes: tuple[int, int] | None) -> None:
        """O provedor recusou por tamanho (a Groq aprende o limite real)."""

    def _resize(
        self, request: GenerationRequest, model: str, extra: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Parâmetros menores para tentar o mesmo modelo de novo (None = não dá)."""
        return None

    def _busy_wait(self, attempts: list[tuple[str, dict[str, Any]]], busy: ProviderError) -> float:
        """Quanto esperar antes da segunda volta quando todos estão cheios."""
        return min(max(busy.retry_after, 2.0), self.busy_wait)

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Abre o stream e repassa texto e raciocínio conforme chegam."""
        response = None
        last: ProviderError | None = None
        busy: ProviderError | None = None
        attempts = self._attempts(request)
        for model, extra in attempts:
            if cancel.cancelled():
                return
            try:
                response = self._open(self._body(request, model, extra))
                break
            except ModelGone as gone:
                # Modelo aposentado ou inexistente: passa para o próximo da cadeia.
                last = gone
            except ProviderError as error:
                if error.code == "model_too_large":
                    smaller = self._resize(request, model, extra)
                    if smaller is not None:
                        try:
                            response = self._open(self._body(request, model, smaller))
                            break
                        except ProviderError as again:
                            if again.code not in ("model_too_large", "model_busy"):
                                raise
                    busy = busy or ProviderError("model_busy")
                    continue
                if error.code != "model_busy":
                    raise
                # Limite de uso deste modelo: o próximo da cadeia tem limite próprio.
                busy = busy or error
        if response is None and busy is not None:
            # Todos cheios: espera o modelo que libera primeiro (com teto) e tenta de novo.
            wait = self._busy_wait(attempts, busy)
            if wait > self.busy_wait:
                # Cota do dia acabou em todos: avisa já, sem prender a pessoa.
                raise ProviderError("model_busy", retry_after=wait)
            if wait > 0 and not cancel.cancelled():
                cancel_event = threading.Event()
                cancel.on_cancel(cancel_event.set)
                cancel_event.wait(wait)
            for model, extra in attempts:
                if cancel.cancelled():
                    return
                try:
                    response = self._open(self._body(request, model, extra))
                    break
                except ProviderError as error:
                    if error.code not in ("model_busy", "model_too_large") and not isinstance(
                        error, ModelGone
                    ):
                        raise
            if response is None:
                raise busy
        if response is None:
            # Toda a cadeia sumiu do provedor: é erro do servidor, não da pessoa.
            logger.error("model.chain_exhausted", extra={"provider": self._name})
            raise ProviderError("model_error") from last

        cancel.on_cancel(response.close)
        stop = "end"
        # Os pedidos de ferramenta chegam fatiados: `index` diz a qual pertencem.
        pending: dict[int, dict[str, str]] = {}
        splitter = _ThinkSplitter()
        try:
            with response:
                for raw in response:
                    if cancel.cancelled():
                        return
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    if not isinstance(chunk, dict):
                        continue
                    if chunk.get("error"):
                        logger.warning("model.stream_error", extra={"provider": self._name})
                        raise ProviderError("model_error")
                    for choice in chunk.get("choices") or ():
                        delta = choice.get("delta") or {}
                        reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                        if isinstance(reasoning, str) and reasoning:
                            yield StreamEvent("thinking", reasoning)
                        content = delta.get("content")
                        if isinstance(content, str) and content:
                            for kind, piece in splitter.feed(content):
                                yield StreamEvent(cast(Any, kind), piece)
                        for piece in delta.get("tool_calls") or ():
                            slot = pending.setdefault(
                                int(piece.get("index", 0)), {"id": "", "name": "", "args": ""}
                            )
                            if piece.get("id"):
                                slot["id"] = str(piece["id"])
                            function = piece.get("function") or {}
                            if function.get("name"):
                                slot["name"] = str(function["name"])
                            if function.get("arguments"):
                                slot["args"] += str(function["arguments"])
                        finish = choice.get("finish_reason")
                        if finish:
                            stop = _FINISH.get(str(finish), "end")
        except TimeoutError:
            if cancel.cancelled():
                return
            raise ProviderError("model_timeout") from None
        except (OSError, ValueError, AttributeError):
            # Conexão fechada pelo cancelamento (ou pela rede no meio do stream).
            if cancel.cancelled():
                return
            raise ProviderError("model_unreachable") from None
        for kind, piece in splitter.flush():
            yield StreamEvent(cast(Any, kind), piece)
        if pending:
            # O KAZER executa e volta: quem fecha o ciclo é o hub.
            for slot in pending.values():
                if not slot["name"]:
                    continue
                yield StreamEvent("tool", call=_openai_call(slot))
            yield StreamEvent("stop", "tool")
            return
        yield StreamEvent("stop", stop)


# ---------------------------------------------------------------------------
# Groq: o esforço escolhido troca o modelo
# ---------------------------------------------------------------------------

# Cada nível aponta para uma cadeia "modelo[:raciocínio]" separada por vírgula:
# o primeiro que existir responde, e os seguintes são reserva caso a Groq
# aposente um modelo. Os IDs mudam com o tempo; por isso cada nível tem uma
# variável de ambiente própria (KAZER_GROQ_MODEL_<NÍVEL>) que vence o padrão.
#
# O KAZ 1.1 público usa só o "baixo", então é ele que precisa ser bom de verdade:
# o gpt-oss-120b (forte em código e com raciocínio nativo) com o raciocínio
# "auto" — o KAZER mede o tamanho da tarefa e pensa mais quando ela pede —, e o
# Kimi K2 e o Llama 3.3 70B de reserva.
GROQ_DEFAULT_TIERS = {
    # Cada modelo tem limite próprio por minuto e por dia na Groq: quanto mais
    # longa a cadeia, mais difícil o KAZER ficar sem resposta.
    "baixo": "openai/gpt-oss-120b:auto,moonshotai/kimi-k2-instruct-0905,"
    "meta-llama/llama-4-scout-17b-16e-instruct,llama-3.3-70b-versatile,"
    "openai/gpt-oss-20b:auto,qwen/qwen3-32b,llama-3.1-8b-instant",
    "medio": "openai/gpt-oss-120b:medium,moonshotai/kimi-k2-instruct-0905",
    "alto": "openai/gpt-oss-120b:high,moonshotai/kimi-k2-instruct-0905",
    "extra": "openai/gpt-oss-120b:high,llama-3.3-70b-versatile",
    "max": "openai/gpt-oss-120b:high,openai/gpt-oss-120b:medium",
}
# Imagens: Llama 4 (multimodal), com reserva.
GROQ_DEFAULT_VISION = (
    "meta-llama/llama-4-maverick-17b-128e-instruct,meta-llama/llama-4-scout-17b-16e-instruct"
)
# Bastidores (título da conversa): modelo pequeno com cota diária grande.
GROQ_LIGHT = "llama-3.1-8b-instant,meta-llama/llama-4-scout-17b-16e-instruct,openai/gpt-oss-20b:low"
# Conversa leve começa por estes (cota por minuto maior que a do gpt-oss-120b).
_LIGHT_FIRST = ("meta-llama/llama-4-scout", "moonshotai/kimi-k2")
_GROQ_REASONING = {"low", "medium", "high"}
_AUTO = "auto"
# Teto de saída por família: alto o bastante para nunca cortar um arquivo no meio.
# (O raciocínio conta dentro do teto nos modelos que pensam.)
_GROQ_MAX_OUT = {
    "openai/gpt-oss": 32_768,
    "moonshotai/kimi-k2": 16_384,
    "llama-3.3-70b": 32_768,
    "llama-3.1-8b": 8_192,
    "qwen/qwen3": 16_384,
    "meta-llama/llama-4": 8_192,
}

# Pensar muito só quando a tarefa pede: construir algo, código com erro, contas
# ou texto longo. Pesquisa e conversa comum ficam rápidas.
_BUILD = re.compile(
    r"\b(cri[ae]|crie|cria|faz|fa[cç]a|fazer|desenvolv|implement|program[ae]|constru|gere|"
    r"gerar|escrev|mont[ae]|refator|corrij|conserte|arrume)\w*\b.{0,60}?\b(jogo|game|app|"
    r"aplicativo|site|p[áa]gina|api|sistema|script|fun[çc][ãa]o|classe|c[óo]digo|programa|"
    r"bot|pdf|slides?|apresenta[çc][ãa]o|relat[óo]rio|documento|planilha|projeto)",
    re.IGNORECASE | re.DOTALL,
)
_CODE = re.compile(
    r"```|traceback|exception|stack ?trace|\berro\b.{0,40}\b(c[óo]digo|linha)|\bbug\b",
    re.IGNORECASE,
)
_ASK = re.compile(
    r"\b(pesquis|procur|busc|compar|quais|qual|melhor|recomend|explic)", re.IGNORECASE
)
_MATH = re.compile(r"\b(calcul|prove|demonstr|equa[çc]|derivad|integral|otimiz)", re.IGNORECASE)


def task_effort(request: GenerationRequest) -> str:
    """Quanto raciocínio a tarefa pede: low, medium ou high.

    Conversa leve responde rápido; código, contas e entregas longas pensam mais.
    É só heurística local — nada do texto sai daqui.
    """
    if "modo KZ Code" in request.system:
        return "high"
    last = next(
        (
            _text_of(turn)
            for turn in reversed(request.turns)
            if turn.role == "user" and not turn.results
        ),
        "",
    )
    if len(last) > 700 or _BUILD.search(last) or _CODE.search(last) or _MATH.search(last):
        return "high"
    if len(last) < 60 and "?" not in last and not _ASK.search(last):
        return "low"
    return "medium"


def _without_images(request: GenerationRequest) -> GenerationRequest:
    from dataclasses import replace

    note = Part(
        "text",
        "[A pessoa anexou uma imagem, mas a leitura de imagens está indisponível agora."
        " Diga isso em uma frase e ajude com o que der pelo texto.]",
    )
    turns = tuple(
        replace(turn, parts=tuple(p if p.kind != "image" else note for p in turn.parts))
        for turn in request.turns
    )
    return replace(request, turns=turns)


def parse_tier(spec: str) -> list[tuple[str, dict[str, Any]]]:
    """"modelo:raciocínio,reserva" vira a lista de tentativas; lixo é ignorado."""
    attempts: list[tuple[str, dict[str, Any]]] = []
    for piece in spec.split(","):
        model, _, reasoning = piece.strip().partition(":")
        model, reasoning = model.strip(), reasoning.strip().lower()
        if not model or any(ch.isspace() for ch in model) or len(model) > 120:
            continue
        extra: dict[str, Any] = {}
        if reasoning in _GROQ_REASONING or reasoning == _AUTO:
            # O raciocínio cru do modelo nunca chega à tela: só o resultado.
            extra = {"reasoning_effort": reasoning, "include_reasoning": False}
        attempts.append((model, extra))
    return attempts


def _groq_max_out(model: str) -> int:
    return next((size for prefix, size in _GROQ_MAX_OUT.items() if model.startswith(prefix)), 0)


class GroqProvider(OpenAICompatibleProvider):
    """KAZ 1.1 na Groq: o nível de esforço decide o modelo, só no servidor.

    O navegador manda `baixo`..`max`; nunca um ID de modelo. Quem mapeia é a
    tabela abaixo, que vem do ambiente, então ninguém escolhe o próprio modelo
    por fora do que o servidor liberou.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        tiers: dict[str, str],
        vision_model: str,
        max_tokens: int,
        timeout: float,
    ) -> None:
        """`tiers` já traz o padrão misturado com o ambiente."""
        self._tiers = {
            level: chain
            for level, spec in tiers.items()
            if level in EFFORTS and (chain := parse_tier(spec))
        }
        self._vision_model = vision_model
        self._vision_chain = parse_tier(vision_model) if vision_model else []
        self.governor = GOVERNOR
        super().__init__(
            name="groq",
            base_url=base_url,
            api_key=api_key,
            model="",
            deep_model="",
            capabilities=Capabilities(
                images=bool(vision_model),
                # O KAZ 1.1 público oferece somente o modo Baixo.
                efforts=("baixo",),
            ),
            send_effort=False,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    def __repr__(self) -> str:
        """Sem chave."""
        return "GroqProvider()"

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Igual ao padrão, mas o raciocínio cru nunca sai daqui.

        Mesmo pedindo ao provedor que o esconda, se ele vier assim mesmo o
        KAZER o descarta: a tela mostra a resposta, não o rascunho do modelo.
        """
        try:
            events = super().stream(request, cancel)
            first = next(events, None)
        except ProviderError as exc:
            has_image = any(p.kind == "image" for turn in request.turns for p in turn.parts)
            if exc.code != "model_error" or not has_image:
                raise
            # Todos os modelos de visão sumiram do provedor: responde sem a imagem,
            # avisando, em vez de deixar a pessoa sem resposta.
            logger.warning("model.vision_unavailable", extra={"provider": "groq"})
            events = super().stream(_without_images(request), cancel)
            first = next(events, None)
        if first is not None and first.kind != "thinking":
            yield first
        for event in events:
            if event.kind != "thinking":
                yield event

    # --- limites: cada modelo da Groq tem cota própria -----------------------

    def _observe(self, model: str, headers: Any, status: int) -> None:
        self.governor.observe(model, headers, status)

    def _too_large(self, model: str, sizes: tuple[int, int] | None) -> None:
        if sizes:
            self.governor.too_large(model, sizes[0])

    def _resize(
        self, request: GenerationRequest, model: str, extra: dict[str, Any]
    ) -> dict[str, Any] | None:
        budget = self.governor.output_budget(
            model, _prompt_tokens(request), _groq_max_out(model) or 8_192
        )
        current = int(extra.get("max_completion_tokens") or 0)
        if budget is None or (current and budget >= current):
            return None
        return {**extra, "max_completion_tokens": budget}

    def _busy_wait(self, attempts: list[tuple[str, dict[str, Any]]], busy: ProviderError) -> float:
        waits = [self.governor.cooling(model) for model, _ in attempts]
        known = min(waits) if waits else 0.0
        return round(max(known, min(busy.retry_after, self.busy_wait), 1.0), 1)

    def _chain(self, request: GenerationRequest) -> list[tuple[str, dict[str, Any]]]:
        """A cadeia de modelos para este pedido, já na ordem de preferência."""
        has_image = any(part.kind == "image" for turn in request.turns for part in turn.parts)
        if has_image and self._vision_chain:
            return list(self._vision_chain)
        if request.light:
            return parse_tier(GROQ_LIGHT)
        # Esforço de fora da tabela (ou desligado pelo ambiente) cai no mais baixo.
        wanted = next(
            (name for name, value in EFFORTS.items() if value == request.effort), "baixo"
        )
        chain = list(self._tiers.get(wanted) or next(iter(self._tiers.values()), []))
        if wanted == "baixo" and not request.deep and task_effort(request) == "low":
            # Conversa leve vai primeiro para modelos com cota folgada: o
            # gpt-oss-120b (o mais forte) fica livre para o que precisa dele.
            light = [item for item in chain if item[0].startswith(_LIGHT_FIRST)]
            chain = light + [item for item in chain if item not in light]
        return chain

    def _attempts(self, request: GenerationRequest) -> list[tuple[str, dict[str, Any]]]:
        prompt = _prompt_tokens(request)
        ready: list[tuple[str, dict[str, Any]]] = []
        later: list[tuple[float, int, tuple[str, dict[str, Any]]]] = []
        unfit: list[tuple[str, dict[str, Any]]] = []
        for position, (model, extra) in enumerate(self._chain(request)):
            extra = dict(extra)
            if extra.get("reasoning_effort") == _AUTO:
                extra["reasoning_effort"] = "high" if request.deep else task_effort(request)
            ceiling = 160 if request.light else _groq_max_out(model)
            if not self._max_tokens and ceiling:
                budget = self.governor.output_budget(model, prompt, ceiling)
                if budget is None:
                    # Nem o pedido cabe no limite por minuto deste modelo.
                    unfit.append((model, extra))
                    continue
                # Cabe no TPM do modelo; se a resposta for maior, ela continua
                # sozinha na próxima chamada (sem corte para a pessoa).
                extra["max_completion_tokens"] = budget
            wait = self.governor.cooling(model, need=prompt + MIN_OUTPUT)
            if wait > 0:
                later.append((wait, position, (model, extra)))
            else:
                ready.append((model, extra))
        ordered = ready + [item for _, _, item in sorted(later, key=lambda w: (w[0], w[1]))]
        # Sem nenhum que caiba, tenta mesmo assim (a Groq ensina o limite real).
        return ordered or unfit


def _prompt_tokens(request: GenerationRequest) -> int:
    """Estimativa local do tamanho do pedido (texto + ferramentas; imagem à parte)."""
    chars = len(request.system)
    for turn in request.turns:
        chars += sum(len(part.text) for part in turn.parts if part.kind != "image")
        chars += sum(len(text) for _, text in turn.results)
        chars += sum(len(call.name) + len(json.dumps(call.arguments)) for call in turn.calls)
    for tool in request.tools:
        chars += len(tool.name) + len(tool.description) + len(json.dumps(tool.schema))
    return estimate_tokens(chars)


# ---------------------------------------------------------------------------
# Anthropic (Claude) pelo SDK oficial
# ---------------------------------------------------------------------------

ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5"
# Modelos com pensamento adaptativo e `output_config.effort`.
_ANTHROPIC_ADAPTIVE = (
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
)
# Modelos com recusa redirecionada pelo servidor (`fallbacks: "default"`).
_ANTHROPIC_FALLBACK = ("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_ANTHROPIC_STOP = {
    "end_turn": "end",
    "stop_sequence": "end",
    "max_tokens": "length",
    "refusal": "refusal",
}


def _anthropic_family(model: str, families: tuple[str, ...]) -> bool:
    return any(model == family or model.startswith(family + "-") for family in families)


class AnthropicProvider:
    """Streaming com `client.beta.messages.stream`, pensamento adaptativo e esforço."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        max_tokens: int,
        timeout: float,
        capabilities: Capabilities,
        adaptive: bool,
    ) -> None:
        """Importa o SDK só quando este provedor é escolhido."""
        import anthropic

        self._sdk = anthropic
        self._client = anthropic.Anthropic(
            api_key=api_key, base_url=base_url or None, timeout=timeout, max_retries=2
        )
        self._model = model
        self._max_tokens = max_tokens
        self._adaptive = adaptive
        self._fallbacks = _anthropic_family(model, _ANTHROPIC_FALLBACK) and not base_url
        self.capabilities = capabilities

    def __repr__(self) -> str:
        """Sem chave."""
        return f"AnthropicProvider(model={self._model!r})"

    @staticmethod
    def _messages(turns: tuple[Turn, ...]) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        for turn in turns:
            blocks: list[dict[str, Any]] = []
            for part in turn.parts:
                if part.kind in ("image", "document"):
                    blocks.append(
                        {
                            "type": part.kind,
                            "source": {
                                "type": "base64",
                                "media_type": part.media_type,
                                "data": base64.b64encode(part.data).decode("ascii"),
                            },
                        }
                    )
            text = _text_of(turn)
            # Resultado de ferramenta vem antes de qualquer texto na fala da pessoa.
            blocks.extend(
                {"type": "tool_result", "tool_use_id": call_id, "content": output}
                for call_id, output in turn.results
            )
            if text:
                blocks.append({"type": "text", "text": text})
            # Ciclo de ferramenta: o pedido vai na fala do modelo e o resultado
            # volta na fala seguinte, como manda o formato.
            blocks.extend(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                for call in turn.calls
            )
            if blocks:
                messages.append({"role": turn.role, "content": blocks})
        return messages

    def _error(self, exc: Exception) -> ProviderError:
        sdk = self._sdk
        if isinstance(exc, sdk.AuthenticationError | sdk.PermissionDeniedError):
            return ProviderError("model_auth")
        if isinstance(exc, sdk.RateLimitError):
            try:
                wait = float(exc.response.headers.get("retry-after", "0"))
            except ValueError:
                wait = 0.0
            return ProviderError("model_busy", retry_after=wait)
        if isinstance(exc, sdk.BadRequestError | sdk.NotFoundError | sdk.UnprocessableEntityError):
            return ProviderError("model_rejected")
        if isinstance(exc, sdk.APITimeoutError):
            return ProviderError("model_timeout")
        if isinstance(exc, sdk.APIConnectionError):
            return ProviderError("model_unreachable")
        if isinstance(exc, sdk.APIStatusError):
            return ProviderError("model_busy" if exc.status_code == 529 else "model_error")
        return ProviderError("model_error")

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Repassa deltas de texto e resumos de raciocínio; continua `pause_turn`."""
        messages = self._messages(request.turns)
        params: dict[str, Any] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "system": request.system,
            "cache_control": {"type": "ephemeral"},
        }
        if self._adaptive:
            params["thinking"] = {"type": "adaptive", "display": "summarized"}
            params["output_config"] = {"effort": "high" if request.deep else request.effort}
        tools: list[dict[str, Any]] = []
        if request.web_search:
            tools.append({"type": "web_search_20260209", "name": "web_search", "max_uses": 5})
        tools.extend(
            {"name": tool.name, "description": tool.description, "input_schema": tool.schema}
            for tool in request.tools
        )
        if tools:
            params["tools"] = tools
            if request.tool_choice == "none":
                params["tool_choice"] = {"type": "none"}
        if self._fallbacks:
            params["betas"] = [_FALLBACK_BETA]
            params["fallbacks"] = "default"

        try:
            # Ferramentas do servidor podem pausar o turno; o histórico só cresce (append-only).
            for _ in range(4):
                if cancel.cancelled():
                    return
                with self._client.beta.messages.stream(
                    messages=cast(Any, messages), **params
                ) as stream:
                    cancel.on_cancel(stream.close)
                    for event in stream:
                        if cancel.cancelled():
                            return
                        if event.type == "content_block_start":
                            if event.content_block.type == "server_tool_use":
                                tool = str(getattr(event.content_block, "name", "") or "")
                                yield StreamEvent("searching")
                                label = _ACTIVITY.get(tool, "Usando uma ferramenta")
                                yield StreamEvent("activity", label)
                            elif event.content_block.type == "web_search_tool_result":
                                yield StreamEvent("activity", _seen(event.content_block))
                        elif event.type == "content_block_delta":
                            if event.delta.type == "text_delta":
                                yield StreamEvent("text", event.delta.text)
                            elif event.delta.type == "thinking_delta" and event.delta.thinking:
                                yield StreamEvent("thinking", event.delta.thinking)
                    final = stream.get_final_message()
                calls = _anthropic_calls(final)
                if calls:
                    # O KAZER executa e volta: quem fecha o ciclo é o hub.
                    for call in calls:
                        yield StreamEvent("tool", call=call)
                    yield StreamEvent("stop", "tool")
                    return
                if final.stop_reason != "pause_turn":
                    yield StreamEvent("stop", _ANTHROPIC_STOP.get(str(final.stop_reason), "end"))
                    return
                messages = [*messages, {"role": "assistant", "content": final.content}]
            yield StreamEvent("stop", "end")
        except self._sdk.APIError as exc:
            if cancel.cancelled():
                return
            error = self._error(exc)
            logger.warning("model.error", extra={"provider": "anthropic", "code": error.code})
            raise error from None
        except (OSError, ValueError, AttributeError):
            if cancel.cancelled():
                return
            raise ProviderError("model_unreachable") from None


# O que a interface mostra enquanto cada ferramenta do servidor roda.
_ACTIVITY = {
    "web_search": "Buscando na web",
    "web_fetch": "Abrindo uma página",
    "code_execution": "Rodando o código",
}


def _openai_call(slot: dict[str, str]) -> ToolCall:
    """Pedaços juntados viram um pedido de ferramenta."""
    try:
        arguments = json.loads(slot["args"] or "{}")
    except ValueError:
        arguments = {}
    return ToolCall(
        id=slot["id"] or slot["name"],
        name=slot["name"],
        arguments=arguments if isinstance(arguments, dict) else {},
    )


def _anthropic_calls(final: Any) -> list[ToolCall]:
    """Pedidos de ferramenta do cliente na resposta final."""
    found: list[ToolCall] = []
    for block in getattr(final, "content", []) or []:
        if getattr(block, "type", "") != "tool_use":
            continue
        arguments = getattr(block, "input", None)
        found.append(
            ToolCall(
                id=str(getattr(block, "id", "")),
                name=str(getattr(block, "name", "")),
                arguments=arguments if isinstance(arguments, dict) else {},
            )
        )
    return found


def _seen(block: Any) -> str:
    """Resume o que a ferramenta devolveu, sem copiar conteúdo externo."""
    content = getattr(block, "content", None)
    if isinstance(content, list):
        total = len(content)
        if total:
            return f"Li {total} resultado{'s' if total > 1 else ''}"
    return "Resultado recebido"


# ---------------------------------------------------------------------------
# Reserva entre provedores (o mesmo padrão do LiteLLM Router, sem a dependência)
# ---------------------------------------------------------------------------

# Falhas que valem tentar outro provedor: limite, fora do ar, demora, erro deles.
# ---------------------------------------------------------------------------
# Montagem a partir da configuração
# ---------------------------------------------------------------------------


def _build_groq(
    settings: Settings, secrets: SecretProvider, base_url: str, max_tokens: int, timeout: float
) -> ModelProvider | None:
    """Groq com o esforço trocando de modelo; sem GROQ_API_KEY não há modelo."""
    try:
        key = secrets.get_secret("GROQ_API_KEY", scope="model")
    except LookupError:
        logger.warning("model.unavailable: GROQ_API_KEY não configurada")
        return None
    tiers = {**GROQ_DEFAULT_TIERS, **settings.groq_tiers}
    vision = settings.groq_vision_model or GROQ_DEFAULT_VISION
    # KAZER_MODEL (se alguém definir) entra como reserva do nível baixo, depois
    # da cadeia padrão: um modelo pequeno antigo no ambiente não pode tomar o
    # lugar do modelo bom (era isso que deixava as respostas rasas).
    if settings.model_name and "baixo" not in settings.groq_tiers:
        tiers["baixo"] = f"{tiers['baixo']},{settings.model_name}"
    provider = GroqProvider(
        base_url=base_url,
        api_key=key,
        tiers=tiers,
        vision_model=vision,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    logger.info(
        "model.ready",
        extra={
            "provider": "groq",
            "host": urlsplit(base_url).hostname,
            "efforts": ",".join(provider.capabilities.efforts),
        },
    )
    return provider


def build_provider(
    settings: Settings, secrets: SecretProvider | None = None
) -> ModelProvider | None:
    """Monta o adaptador do KAZ 1.1 ou None (a interface mostra "não configurado").

    Logs citam apenas o motivo, nunca valores de chave ou URLs completas.
    """
    secrets = secrets or EnvironmentSecretProvider()
    problems = settings.model_blockers
    if problems:
        logger.warning("model.unavailable: %s", "; ".join(problems))
        return None
    name = settings.model_provider
    max_tokens = settings.model_max_output_tokens
    timeout = settings.model_timeout_seconds

    if name == "anthropic":
        try:
            anthropic_key = secrets.get_secret("ANTHROPIC_API_KEY", scope="model")
        except LookupError:
            logger.warning("model.unavailable: ANTHROPIC_API_KEY não configurada")
            return None
        model = settings.model_name or ANTHROPIC_DEFAULT_MODEL
        adaptive = settings.model_reasoning != "off" and _anthropic_family(
            model, _ANTHROPIC_ADAPTIVE
        )
        capabilities = Capabilities(
            deep=adaptive,
            images=settings.model_vision is not False,
            documents=True,
            web_search=settings.model_web_search,
        )
        try:
            return AnthropicProvider(
                api_key=anthropic_key,
                model=model,
                base_url=settings.model_base_url,
                max_tokens=max_tokens or 64_000,
                timeout=timeout,
                capabilities=capabilities,
                adaptive=adaptive,
            )
        except ImportError:
            logger.warning("model.unavailable: instale o extra kazer[anthropic]")
            return None

    preset = _PRESETS[name]
    base_url = settings.model_base_url or preset.base_url
    if name == "groq":
        return _build_groq(settings, secrets, base_url, max_tokens, timeout)
    key: str | None = None
    if preset.secret:
        try:
            key = secrets.get_secret(preset.secret, scope="model")
        except LookupError:
            # Servidores locais/próprios podem dispensar chave; os públicos não.
            if name != "custom":
                logger.warning("model.unavailable: %s não configurada", preset.secret)
                return None
    send_effort = settings.model_reasoning == "effort"
    capabilities = Capabilities(
        deep=bool(settings.model_deep_name) or send_effort,
        images=preset.vision if settings.model_vision is None else settings.model_vision,
        documents=False,
        web_search=False,
    )
    logger.info("model.ready", extra={"provider": name, "host": urlsplit(base_url).hostname})
    return OpenAICompatibleProvider(
        name=name,
        base_url=base_url,
        api_key=key,
        model=settings.model_name,
        deep_model=settings.model_deep_name,
        capabilities=capabilities,
        send_effort=send_effort,
        max_tokens=max_tokens,
        timeout=timeout,
    )
