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


def _model_gone(exc: urllib.error.HTTPError) -> bool:
    """O erro diz que o modelo sumiu? Lê só o código; o corpo nunca vai ao log."""
    if exc.code == 404:
        return True
    if exc.code != 400:
        return False
    try:
        body = json.loads(exc.read(4096))
    except (OSError, ValueError):
        return False
    error = body.get("error") if isinstance(body, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    return isinstance(code, str) and code in _GONE_CODES


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
        try:
            return urllib.request.urlopen(http_request, timeout=self._timeout)  # noqa: S310
        except urllib.error.HTTPError as exc:
            gone = _model_gone(exc)
            exc.close()
            logger.warning(
                "model.http_error",
                extra={"provider": self._name, "status": exc.code, "model_gone": gone},
            )
            error = _status_error(exc.code, exc.headers.get("retry-after"))
            raise ModelGone(error.code, error.retry_after) if gone else error from None
        except TimeoutError:
            raise ProviderError("model_timeout") from None
        except (urllib.error.URLError, ssl.SSLError, OSError):
            logger.warning("model.unreachable", extra={"provider": self._name})
            raise ProviderError("model_unreachable") from None

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        """Abre o stream e repassa texto e raciocínio conforme chegam."""
        response = None
        last: ProviderError | None = None
        for model, extra in self._attempts(request):
            try:
                response = self._open(self._body(request, model, extra))
                break
            except ModelGone as gone:
                # Modelo aposentado ou inexistente: passa para o próximo da cadeia.
                last = gone
        if response is None:
            # Toda a cadeia sumiu do provedor: é erro do servidor, não da pessoa.
            logger.error("model.chain_exhausted", extra={"provider": self._name})
            raise ProviderError("model_error") from last

        cancel.on_cancel(response.close)
        stop = "end"
        # Os pedidos de ferramenta chegam fatiados: `index` diz a qual pertencem.
        pending: dict[int, dict[str, str]] = {}
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
GROQ_DEFAULT_TIERS = {
    "baixo": "llama-3.1-8b-instant,openai/gpt-oss-20b:low",
    "medio": "openai/gpt-oss-20b:medium,llama-3.1-8b-instant",
    "alto": "llama-3.3-70b-versatile,openai/gpt-oss-120b:medium",
    "extra": "openai/gpt-oss-120b:medium,llama-3.3-70b-versatile",
    "max": "openai/gpt-oss-120b:high,openai/gpt-oss-120b:medium",
}
_GROQ_REASONING = {"low", "medium", "high"}


def parse_tier(spec: str) -> list[tuple[str, dict[str, Any]]]:
    """"modelo:raciocínio,reserva" vira a lista de tentativas; lixo é ignorado."""
    attempts: list[tuple[str, dict[str, Any]]] = []
    for piece in spec.split(","):
        model, _, reasoning = piece.strip().partition(":")
        model, reasoning = model.strip(), reasoning.strip().lower()
        if not model or any(ch.isspace() for ch in model) or len(model) > 120:
            continue
        extra: dict[str, Any] = {}
        if reasoning in _GROQ_REASONING:
            # O raciocínio cru do modelo nunca chega à tela: só o resultado.
            extra = {"reasoning_effort": reasoning, "include_reasoning": False}
        attempts.append((model, extra))
    return attempts


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
        super().__init__(
            name="groq",
            base_url=base_url,
            api_key=api_key,
            model="",
            deep_model="",
            capabilities=Capabilities(
                images=bool(vision_model),
                efforts=tuple(level for level in EFFORTS if level in self._tiers),
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
        for event in super().stream(request, cancel):
            if event.kind != "thinking":
                yield event

    def _attempts(self, request: GenerationRequest) -> list[tuple[str, dict[str, Any]]]:
        has_image = any(
            part.kind == "image" for turn in request.turns for part in turn.parts
        )
        if has_image and self._vision_model:
            return [(self._vision_model, {})]
        # Esforço de fora da tabela (ou desligado pelo ambiente) cai no mais baixo.
        wanted = next((name for name, value in EFFORTS.items() if value == request.effort), "baixo")
        chain = self._tiers.get(wanted) or next(iter(self._tiers.values()), [])
        return list(chain)


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
            # Ciclo de ferramenta: o pedido vai na fala do modelo e o resultado
            # volta na fala seguinte, como manda o formato.
            blocks.extend(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                for call in turn.calls
            )
            blocks.extend(
                {"type": "tool_result", "tool_use_id": call_id, "content": output}
                for call_id, output in turn.results
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
    # KAZER_MODEL (se alguém definir) vira o nível mais baixo: compatível com
    # quem já configurou um modelo único.
    if settings.model_name and "baixo" not in settings.groq_tiers:
        tiers["baixo"] = settings.model_name
    provider = GroqProvider(
        base_url=base_url,
        api_key=key,
        tiers=tiers,
        vision_model=settings.groq_vision_model,
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
