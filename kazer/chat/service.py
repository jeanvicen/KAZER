"""Regras do chat: validação, posse, cota, anexos, memória e preferências.

A identidade sempre vem da sessão validada no servidor (`user_id`); nada que o
navegador envie decide de quem é uma conversa. Opções de execução (modelo,
esforço, pensamento profundo, busca, memória) são validadas contra o que o
modelo configurado realmente suporta, sem simular recursos inexistentes.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from kazer.brain.model_provider import (
    EFFORTS,
    PUBLIC_MODEL_ID,
    PUBLIC_MODEL_LABEL,
    GenerationRequest,
    ModelProvider,
)
from kazer.chat import context
from kazer.chat.generation import GenerationHub, LiveGeneration
from kazer.chat.store import (
    Attachment,
    AttachmentUnavailable,
    ChatStore,
    Conversation,
    ConversationMissing,
    Exchange,
    LimitReached,
    Memory,
    Message,
    UsageWindow,
    new_id,
)
from kazer.chat.uploads import (
    MAX_PENDING_PER_USER,
    MAX_STORAGE_PER_USER,
    MAX_TEXT_BYTES,
    TEXT_EXTENSIONS,
    UploadRejected,
    UploadStorage,
    clean_name,
    detect,
    valid_id,
)
from kazer.security.rate_limiter import RateLimit, RateLimiter

logger = logging.getLogger("kazer.chat")

MAX_MESSAGE_CHARS = 32_000
MAX_ATTACHMENTS = 6
MAX_TITLE_CHARS = 80
MAX_MEMORIES = 100
MAX_MEMORY_CHARS = 500
PAGE_MESSAGES = 40
PAGE_CONVERSATIONS = 30
CONTEXT_MESSAGES = 60
ORPHAN_TTL = 24 * 3600
USAGE_TTL = 2 * 24 * 3600

# Pensamento profundo e busca consomem mais do provedor; a cota reflete isso.
UNITS_BASE = 1
UNITS_DEEP = 2
UNITS_WEB = 1

PREFERENCE_DEFAULTS: dict[str, Any] = {
    "nickname": "",
    "style": "equilibrado",
    "instructions": "",
    "memory_enabled": True,
    "send_on_enter": True,
    "motion": "sistema",
    "text_size": "m",
    "ambient": True,
}
_CHOICES = {
    "style": {"direto", "equilibrado", "detalhado"},
    "motion": {"sistema", "reduzido", "completo"},
    "text_size": {"p", "m", "g"},
}
_TEXT_LIMITS = {"nickname": 40, "instructions": 1500}
_BOOLS = {"memory_enabled", "send_on_enter", "ambient"}

_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class ChatError(Exception):
    """Falha esperada com código estável e dados extras seguros para o navegador."""

    def __init__(
        self, code: str, status: int, retry_after: float = 0.0, **extra: Any
    ) -> None:
        """`extra` só com valores calculados no servidor (por exemplo `reset_at`)."""
        super().__init__(code)
        self.code = code
        self.status = status
        self.retry_after = retry_after
        self.extra = extra


@dataclass(frozen=True, slots=True)
class SendOptions:
    """Opções de execução já validadas."""

    effort: str
    deep: bool
    web_search: bool
    memory: bool

    def as_dict(self) -> dict[str, Any]:
        """Gravado junto da mensagem para auditoria de uso."""
        return {
            "model": PUBLIC_MODEL_ID,
            "effort": self.effort,
            "deep": self.deep,
            "web_search": self.web_search,
            "memory": self.memory,
        }

    @property
    def units(self) -> int:
        """Custo na cota do servidor."""
        return UNITS_BASE + (UNITS_DEEP if self.deep else 0) + (UNITS_WEB if self.web_search else 0)


def _title_from(content: str, attachments: list[Attachment]) -> str:
    text = " ".join(content.split())
    if not text:
        return attachments[0].name if attachments else "Nova conversa"
    if len(text) <= MAX_TITLE_CHARS:
        return text
    cut = text[:MAX_TITLE_CHARS].rsplit(" ", 1)[0]
    return (cut or text[:MAX_TITLE_CHARS]).rstrip(" ,.;:") + "…"


class ChatService:
    """Serviço síncrono (exceto o acompanhamento de streams), sem acesso ao HTTP."""

    def __init__(
        self,
        store: ChatStore,
        uploads: UploadStorage,
        provider: ModelProvider | None,
        *,
        hourly_units: int = 60,
        daily_units: int = 300,
        limiter: RateLimiter | None = None,
        clock: Callable[[], float] = time.time,
        hub: GenerationHub | None = None,
    ) -> None:
        """`provider` None: o chat funciona para histórico, mas não gera respostas."""
        self._store = store
        self._uploads = uploads
        self._provider = provider
        self._clock = clock
        self._limiter = limiter or RateLimiter()
        self._windows = (UsageWindow(3600, hourly_units), UsageWindow(86400, daily_units))
        self._hub = hub or (GenerationHub(store, provider, clock=clock) if provider else None)
        self._last_purge = 0

    def _now(self) -> int:
        return int(self._clock())

    def initialize(self) -> None:
        """Cria as tabelas e limpa anexos órfãos."""
        self._store.initialize(self._now())
        self.purge()

    def purge(self) -> None:
        """Retenção: anexos nunca enviados somem em 1 dia; contagem de uso, em 2."""
        for user_id, attachment_id in self._store.purge_orphan_attachments(
            self._now() - ORPHAN_TTL
        ):
            self._uploads.delete(user_id, attachment_id)
        self._store.purge_usage(self._now() - USAGE_TTL)

    def _purge_hourly(self) -> None:
        # Servidores que ficam no ar por semanas também aplicam a retenção.
        if self._now() - self._last_purge >= 3600:
            self._last_purge = self._now()
            self.purge()

    def shutdown(self) -> None:
        """Interrompe gerações em andamento no encerramento do servidor."""
        if self._hub is not None:
            self._hub.shutdown()

    # ---------- Configuração pública ----------

    def config(self) -> dict[str, Any]:
        """O que a interface pode mostrar: só capacidades reais, nada do provedor."""
        caps = self._provider.capabilities if self._provider else None
        accept: list[str] = []
        if caps and caps.images:
            accept += ["image/png", "image/jpeg", "image/webp", "image/gif"]
        if caps and caps.documents:
            accept.append("application/pdf")
        accept += sorted(f".{ext}" for ext in TEXT_EXTENSIONS)
        return {
            "available": self._provider is not None,
            "model": {"id": PUBLIC_MODEL_ID, "label": PUBLIC_MODEL_LABEL},
            "models": [{"id": PUBLIC_MODEL_ID, "label": PUBLIC_MODEL_LABEL}],
            "effort": "baixo",
            "efforts": [{"id": "baixo", "label": "Baixo"}],
            "features": {
                "deep": bool(caps and caps.deep),
                "images": bool(caps and caps.images),
                "pdf": bool(caps and caps.documents),
                "files": self._provider is not None,
                "web_search": bool(caps and caps.web_search),
                "research": False,
                "memory": True,
                "voice": False,
                "connectors": [],
            },
            "limits": {
                "max_chars": MAX_MESSAGE_CHARS,
                "max_attachments": MAX_ATTACHMENTS,
                "max_text_bytes": MAX_TEXT_BYTES,
            },
            "accept": accept,
        }

    # ---------- Preferências ----------

    def preferences(self, user_id: str) -> dict[str, Any]:
        """Preferências com padrões aplicados (valores inválidos antigos são ignorados)."""
        stored = self._store.get_preferences(user_id)
        merged = dict(PREFERENCE_DEFAULTS)
        for key, value in stored.items():
            if key in merged and type(value) is type(merged[key]):
                merged[key] = value
        return merged

    def update_preferences(self, user_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        """Aplica mudanças parciais validadas campo a campo."""
        current = self.preferences(user_id)
        for key, value in changes.items():
            if key not in PREFERENCE_DEFAULTS:
                raise ChatError("invalid_request", 400)
            if key in _BOOLS:
                if not isinstance(value, bool):
                    raise ChatError("invalid_request", 400)
            elif key in _CHOICES:
                if value not in _CHOICES[key]:
                    raise ChatError("invalid_request", 400)
            elif key in _TEXT_LIMITS:
                if not isinstance(value, str) or len(value) > _TEXT_LIMITS[key]:
                    raise ChatError("invalid_request", 400)
                value = value.strip() if key == "nickname" else value
            current[key] = value
        self._store.save_preferences(user_id, current, self._now())
        return current

    # ---------- Memórias ----------

    def memories(self, user_id: str) -> list[Memory]:
        """Memórias que a pessoa salvou."""
        return self._store.list_memories(user_id)

    def add_memory(self, user_id: str, content: Any) -> Memory:
        """Salva uma memória curta escrita pela própria pessoa."""
        if not isinstance(content, str):
            raise ChatError("invalid_request", 400)
        text = " ".join(content.split())
        if not text:
            raise ChatError("empty_memory", 400)
        if len(text) > MAX_MEMORY_CHARS:
            raise ChatError("memory_too_long", 400)
        memory = self._store.add_memory(user_id, text, self._now(), MAX_MEMORIES)
        if memory is None:
            raise ChatError("memory_full", 409)
        return memory

    def delete_memory(self, user_id: str, memory_id: str) -> None:
        """Remove uma memória; outra conta recebe o mesmo "não encontrado"."""
        if not valid_id(memory_id) or not self._store.delete_memory(user_id, memory_id):
            raise ChatError("not_found", 404)

    def clear_memories(self, user_id: str) -> None:
        """Esquece todas as memórias da conta."""
        self._store.delete_all_memories(user_id)

    # ---------- Conversas ----------

    def list_conversations(
        self, user_id: str, *, cursor: str | None, query: str | None
    ) -> dict[str, Any]:
        """Página de conversas com cursor opaco."""
        before: tuple[int, str] | None = None
        if cursor:
            stamp, _, last_id = cursor.partition(".")
            if not stamp.isdigit() or not valid_id(last_id):
                raise ChatError("invalid_request", 400)
            before = (int(stamp), last_id)
        search = " ".join((query or "").split())[:80]
        items = self._store.list_conversations(
            user_id, limit=PAGE_CONVERSATIONS + 1, before=before, query=search
        )
        has_more = len(items) > PAGE_CONVERSATIONS
        items = items[:PAGE_CONVERSATIONS]
        next_cursor = f"{items[-1].updated_at}.{items[-1].id}" if has_more and items else None
        return {"items": [item.public() for item in items], "next": next_cursor}

    def conversation(self, user_id: str, conversation_id: str) -> Conversation:
        """Conversa da própria conta ou 404 (sem revelar se existe para outra)."""
        found = (
            self._store.get_conversation(user_id, conversation_id)
            if valid_id(conversation_id)
            else None
        )
        if found is None:
            raise ChatError("not_found", 404)
        return found

    def messages(
        self, user_id: str, conversation_id: str, before: str | None
    ) -> dict[str, Any]:
        """Página de mensagens (mais recentes por padrão) e se há anteriores."""
        before_seq: int | None = None
        if before:
            if not before.isdigit():
                raise ChatError("invalid_request", 400)
            before_seq = int(before)
        page = (
            self._store.list_messages(
                user_id, conversation_id, limit=PAGE_MESSAGES, before_seq=before_seq
            )
            if valid_id(conversation_id)
            else None
        )
        if page is None:
            raise ChatError("not_found", 404)
        items, has_more = page
        return {"items": [message.public() for message in items], "has_more": has_more}

    def rename(self, user_id: str, conversation_id: str, title: Any) -> Conversation:
        """Renomeia a conversa."""
        if not isinstance(title, str):
            raise ChatError("invalid_request", 400)
        clean = " ".join(title.split())[:MAX_TITLE_CHARS]
        if not clean:
            raise ChatError("invalid_request", 400)
        if not valid_id(conversation_id) or not self._store.rename_conversation(
            user_id, conversation_id, clean
        ):
            raise ChatError("not_found", 404)
        return self.conversation(user_id, conversation_id)

    def delete_conversation(self, user_id: str, conversation_id: str) -> None:
        """Apaga conversa, mensagens e arquivos anexados."""
        if self._hub is not None and valid_id(conversation_id):
            for live in self._live_in(conversation_id, user_id):
                live.cancel.cancel()
        removed = (
            self._store.delete_conversation(user_id, conversation_id)
            if valid_id(conversation_id)
            else None
        )
        if removed is None:
            raise ChatError("not_found", 404)
        for attachment_id in removed:
            self._uploads.delete(user_id, attachment_id)

    def delete_all(self, user_id: str) -> None:
        """Apaga todo o histórico da conta."""
        for attachment_id in self._store.delete_all_conversations(user_id):
            self._uploads.delete(user_id, attachment_id)

    def _live_in(self, conversation_id: str, user_id: str) -> list[LiveGeneration]:
        hub = self._hub
        if hub is None:
            return []
        page = self._store.list_messages(user_id, conversation_id, limit=2)
        if page is None:
            return []
        return [
            live
            for message in page[0]
            if (live := hub.get(user_id, message.id)) is not None
        ]

    # ---------- Envio ----------

    def _options(self, data: dict[str, Any], memory_enabled: bool) -> SendOptions:
        if data.get("model", PUBLIC_MODEL_ID) != PUBLIC_MODEL_ID:
            raise ChatError("invalid_model", 400)
        effort = data.get("effort", "baixo")
        if effort not in EFFORTS:
            raise ChatError("invalid_effort", 400)
        tools = data.get("tools", {})
        if not isinstance(tools, dict):
            raise ChatError("invalid_request", 400)
        deep, web, research = data.get("deep", False), tools.get("web_search", False), tools.get(
            "research", False
        )
        memory = tools.get("memory", True)
        if not all(isinstance(flag, bool) for flag in (deep, web, research, memory)):
            raise ChatError("invalid_request", 400)
        caps = self._provider.capabilities if self._provider else None
        if deep and not (caps and caps.deep):
            raise ChatError("deep_unavailable", 400)
        if web and not (caps and caps.web_search):
            raise ChatError("web_search_unavailable", 400)
        if research:
            raise ChatError("research_unavailable", 400)
        return SendOptions(
            effort=EFFORTS[effort], deep=deep, web_search=web, memory=memory and memory_enabled
        )

    def _check_attachments(self, user_id: str, ids: Any) -> list[str]:
        if not isinstance(ids, list) or len(ids) > MAX_ATTACHMENTS:
            raise ChatError("invalid_request", 400)
        if not all(isinstance(item, str) and valid_id(item) for item in ids):
            raise ChatError("attachment_invalid", 400)
        unique = list(dict.fromkeys(ids))
        caps = self._provider.capabilities if self._provider else None
        for attachment_id in unique:
            attachment = self._store.get_attachment(user_id, attachment_id)
            if attachment is None or attachment.message_id is not None:
                raise ChatError("attachment_invalid", 400)
            if attachment.kind == "image" and not (caps and caps.images):
                raise ChatError("images_unavailable", 400)
            if attachment.kind == "pdf" and not (caps and caps.documents):
                raise ChatError("documents_unavailable", 400)
        return unique

    def send(self, user_id: str, data: dict[str, Any]) -> tuple[Exchange, LiveGeneration | None]:
        """Valida, registra a pergunta e inicia a resposta (idempotente por `client_id`)."""
        client_id = data.get("client_id")
        if not isinstance(client_id, str) or not _CLIENT_ID.match(client_id):
            raise ChatError("invalid_request", 400)
        content = data.get("content", "")
        if not isinstance(content, str):
            raise ChatError("invalid_request", 400)
        content = content.strip()
        if len(content) > MAX_MESSAGE_CHARS:
            raise ChatError("message_too_long", 400)
        attachment_ids = self._check_attachments(user_id, data.get("attachments", []))
        if not content and not attachment_ids:
            raise ChatError("empty_message", 400)
        conversation_id = data.get("conversation_id")
        if conversation_id is not None and (
            not isinstance(conversation_id, str) or not valid_id(conversation_id)
        ):
            raise ChatError("not_found", 404)
        timezone = data.get("timezone")
        if timezone is not None and not isinstance(timezone, str):
            raise ChatError("invalid_request", 400)

        if self._provider is None or self._hub is None:
            raise ChatError("model_unavailable", 503)
        self._purge_hourly()
        # Reenvio do mesmo pedido (rede instável): devolve a troca original, sem cobrar de novo.
        duplicate = self._store.find_exchange(user_id, client_id)
        if duplicate is not None:
            return duplicate, self._hub.get(user_id, duplicate.reply.id)
        prefs = self.preferences(user_id)
        options = self._options(data, prefs["memory_enabled"])
        if conversation_id and self._hub.busy(conversation_id):
            raise ChatError("busy", 409)
        wait = self._limiter.hit(f"send:{user_id}", RateLimit(20, 60))
        if wait > 0:
            raise ChatError("rate_limited", 429, retry_after=wait)
        if not self._hub.try_reserve():
            raise ChatError("capacity", 503, retry_after=10)

        try:
            pending = [
                attachment
                for item in attachment_ids
                if (attachment := self._store.get_attachment(user_id, item)) is not None
            ]
            exchange = self._store.begin_exchange(
                user_id,
                conversation_id=conversation_id,
                title=_title_from(content, pending),
                content=content,
                client_id=client_id,
                attachment_ids=attachment_ids,
                options=options.as_dict(),
                units=options.units,
                windows=self._windows,
                now=self._now(),
            )
        except LimitReached as exc:
            self._hub.release()
            wait = max(exc.reset_at - self._now(), 1)
            raise ChatError("usage_limit", 429, retry_after=wait, reset_at=exc.reset_at) from None
        except ConversationMissing:
            self._hub.release()
            raise ChatError("not_found", 404) from None
        except AttachmentUnavailable:
            self._hub.release()
            raise ChatError("attachment_invalid", 400) from None
        except BaseException:
            self._hub.release()
            raise

        if exchange.duplicate:
            self._hub.release()
            return exchange, self._hub.get(user_id, exchange.reply.id)
        request = self._request(user_id, exchange.user_message, options, prefs, timezone)
        live = self._hub.start(user_id, exchange.conversation.id, exchange.reply.id, request)
        logger.info("chat.message_accepted", extra={"units": options.units})
        return exchange, live

    def retry(
        self, user_id: str, reply_id: str, timezone: str | None
    ) -> tuple[Message, LiveGeneration]:
        """Gera de novo a última resposta que falhou ou foi interrompida."""
        if self._provider is None or self._hub is None:
            raise ChatError("model_unavailable", 503)
        if not valid_id(reply_id):
            raise ChatError("not_found", 404)
        current = self._store.get_message(user_id, reply_id)
        if current is None:
            raise ChatError("not_found", 404)
        if self._hub.busy(current.conversation_id):
            raise ChatError("busy", 409)
        options = SendOptions(
            effort=str(current.options.get("effort", "low")),
            deep=bool(current.options.get("deep", False)),
            web_search=bool(current.options.get("web_search", False)),
            memory=bool(current.options.get("memory", True)),
        )
        caps = self._provider.capabilities
        if (options.deep and not caps.deep) or (options.web_search and not caps.web_search):
            options = SendOptions(options.effort, options.deep and caps.deep,
                                  options.web_search and caps.web_search, options.memory)
        if not self._hub.try_reserve():
            raise ChatError("capacity", 503, retry_after=10)
        try:
            restarted = self._store.restart_reply(
                user_id, reply_id, units=options.units, windows=self._windows, now=self._now()
            )
        except LimitReached as exc:
            self._hub.release()
            wait = max(exc.reset_at - self._now(), 1)
            raise ChatError("usage_limit", 429, retry_after=wait, reset_at=exc.reset_at) from None
        except BaseException:
            self._hub.release()
            raise
        if restarted is None:
            self._hub.release()
            raise ChatError("not_retryable", 409)
        question, reply = restarted
        prefs = self.preferences(user_id)
        options = SendOptions(
            options.effort,
            options.deep,
            options.web_search,
            options.memory and prefs["memory_enabled"],
        )
        request = self._request(user_id, question, options, prefs, timezone)
        live = self._hub.start(user_id, reply.conversation_id, reply.id, request)
        return reply, live

    def _request(
        self,
        user_id: str,
        question: Message,
        options: SendOptions,
        prefs: dict[str, Any],
        timezone: str | None,
    ) -> GenerationRequest:
        provider = self._provider
        assert provider is not None
        history = self._store.context_messages(
            question.conversation_id, question.seq, CONTEXT_MESSAGES
        )
        turns = context.build_turns(
            history,
            lambda attachment: self._uploads.read(user_id, attachment.id),
            images=provider.capabilities.images,
            documents=provider.capabilities.documents,
        )
        system = context.system_prompt(
            now=self._clock(),
            timezone=timezone,
            nickname=str(prefs["nickname"]),
            style=str(prefs["style"]),
            instructions=str(prefs["instructions"]),
            memories=self._store.list_memories(user_id) if options.memory else [],
            web_search=options.web_search,
        )
        return GenerationRequest(
            system=system,
            turns=turns,
            effort=options.effort,
            deep=options.deep,
            web_search=options.web_search,
        )

    def live(self, user_id: str, reply_id: str) -> LiveGeneration | None:
        """Geração ainda acompanhável (para reconectar depois de queda de rede)."""
        if self._hub is None or not valid_id(reply_id):
            return None
        return self._hub.get(user_id, reply_id)

    def message(self, user_id: str, message_id: str) -> Message:
        """Estado gravado de uma mensagem da própria conta."""
        found = self._store.get_message(user_id, message_id) if valid_id(message_id) else None
        if found is None:
            raise ChatError("not_found", 404)
        return found

    def stop(self, user_id: str, reply_id: str) -> None:
        """Interrompe a resposta em andamento."""
        if self._hub is None or not valid_id(reply_id) or not self._hub.cancel(user_id, reply_id):
            # Já terminou (ou não é desta conta): o estado gravado responde por ela.
            self.message(user_id, reply_id)

    # ---------- Anexos ----------

    def upload(self, user_id: str, raw_name: str, data: bytes) -> Attachment:
        """Valida pelo conteúdo, aplica cotas e grava em disco privado."""
        wait = self._limiter.hit(f"upload:{user_id}", RateLimit(60, 3600))
        if wait > 0:
            raise ChatError("rate_limited", 429, retry_after=wait)
        if self._provider is None:
            raise ChatError("model_unavailable", 503)
        name = clean_name(raw_name)
        try:
            detected = detect(data, name)
        except UploadRejected as exc:
            raise ChatError(exc.code, exc.status) from None
        caps = self._provider.capabilities
        if detected.kind == "image" and not caps.images:
            raise ChatError("images_unavailable", 415)
        if detected.kind == "pdf" and not caps.documents:
            raise ChatError("documents_unavailable", 415)
        self._purge_hourly()
        used, pending = self._store.storage_used(user_id)
        if pending >= MAX_PENDING_PER_USER or used + len(data) > MAX_STORAGE_PER_USER:
            raise ChatError("attachment_quota", 413)
        attachment = Attachment(
            id=new_id(),
            user_id=user_id,
            message_id=None,
            kind=detected.kind,
            media_type=detected.media_type,
            name=name,
            size=len(data),
            created_at=self._now(),
        )
        self._uploads.save(user_id, attachment.id, data)
        try:
            self._store.create_attachment(attachment)
        except BaseException:
            self._uploads.delete(user_id, attachment.id)
            raise
        return attachment

    def attachment(self, user_id: str, attachment_id: str) -> tuple[Attachment, bytes]:
        """Conteúdo de um anexo da própria conta."""
        found = (
            self._store.get_attachment(user_id, attachment_id) if valid_id(attachment_id) else None
        )
        data = self._uploads.read(user_id, attachment_id) if found else None
        if found is None or data is None:
            raise ChatError("not_found", 404)
        return found, data

    def discard_attachment(self, user_id: str, attachment_id: str) -> None:
        """Remove anexo ainda não enviado."""
        if not valid_id(attachment_id) or not self._store.delete_pending_attachment(
            user_id, attachment_id
        ):
            raise ChatError("not_found", 404)
        self._uploads.delete(user_id, attachment_id)

    # ---------- Conta ----------

    def export(self, user_id: str) -> dict[str, Any]:
        """Dados do chat para download pela própria pessoa."""
        return self._store.export(user_id)

    def forget_user(self, user_id: str) -> None:
        """Depois de excluir a conta (o banco já apagou em cascata), remove os arquivos."""
        self._uploads.delete_user(user_id)
