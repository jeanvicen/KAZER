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
import ssl
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast
from urllib.parse import urlsplit

from kazer.config.settings import Settings
from kazer.security.secrets import EnvironmentSecretProvider, SecretProvider

logger = logging.getLogger("kazer.model")

PUBLIC_MODEL_ID = "kaz-1.1"
PUBLIC_MODEL_LABEL = "KAZ 1.1"
# Único esforço exposto nesta versão; o servidor rejeita qualquer outro valor.
EFFORTS = {"baixo": "low"}


@dataclass(frozen=True, slots=True)
class Capabilities:
    """O que o modelo configurado realmente suporta (a interface só mostra isso)."""

    deep: bool = False
    images: bool = False
    documents: bool = False
    web_search: bool = False


@dataclass(frozen=True, slots=True)
class Part:
    """Pedaço de uma mensagem enviada ao modelo."""

    kind: Literal["text", "image", "document"]
    text: str = ""
    media_type: str = ""
    data: bytes = b""


@dataclass(frozen=True, slots=True)
class Turn:
    """Uma fala do histórico, já filtrada e pertencente ao dono da conversa."""

    role: Literal["user", "assistant"]
    parts: tuple[Part, ...]


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    """Pedido validado: o adaptador nunca recebe valores vindos direto do navegador."""

    system: str
    turns: tuple[Turn, ...]
    effort: str = "low"
    deep: bool = False
    web_search: bool = False


@dataclass(frozen=True, slots=True)
class StreamEvent:
    """Evento incremental: texto, resumo de raciocínio, busca ou fim (com motivo)."""

    kind: Literal["text", "thinking", "searching", "activity", "stop"]
    text: str = ""


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

    def __repr__(self) -> str:
        """Sem chave nem URL completa."""
        return f"OpenAICompatibleProvider(name={self._name!r})"

    def _messages(self, request: GenerationRequest) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": request.system}]
        for turn in request.turns:
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

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Abre o stream e repassa texto e raciocínio conforme chegam."""
        model = self._deep_model if request.deep and self._deep_model else self._model
        body: dict[str, Any] = {
            "model": model,
            "messages": self._messages(request),
            "stream": True,
        }
        if self._send_effort:
            body["reasoning_effort"] = "high" if request.deep else request.effort
        if self._max_tokens:
            body["max_tokens"] = self._max_tokens
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
        try:
            response = urllib.request.urlopen(http_request, timeout=self._timeout)  # noqa: S310
        except urllib.error.HTTPError as exc:
            exc.close()
            logger.warning("model.http_error", extra={"provider": self._name, "status": exc.code})
            raise _status_error(exc.code, exc.headers.get("retry-after")) from None
        except TimeoutError:
            raise ProviderError("model_timeout") from None
        except (urllib.error.URLError, ssl.SSLError, OSError):
            logger.warning("model.unreachable", extra={"provider": self._name})
            raise ProviderError("model_unreachable") from None

        cancel.on_cancel(response.close)
        stop = "end"
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
                            yield StreamEvent("text", content)
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
        yield StreamEvent("stop", stop)


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
            if text:
                blocks.append({"type": "text", "text": text})
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
        if request.web_search:
            params["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]
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


def _seen(block: Any) -> str:
    """Resume o que a ferramenta devolveu, sem copiar conteúdo externo."""
    content = getattr(block, "content", None)
    if isinstance(content, list):
        total = len(content)
        if total:
            return f"Li {total} resultado{'s' if total > 1 else ''}"
    return "Resultado recebido"


# ---------------------------------------------------------------------------
# Montagem a partir da configuração
# ---------------------------------------------------------------------------


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
