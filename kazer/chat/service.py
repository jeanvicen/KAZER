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
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from functools import partial
from typing import Any

from kazer.brain.model_provider import (
    EFFORTS,
    PUBLIC_MODEL_ID,
    PUBLIC_MODEL_LABEL,
    CancelToken,
    GenerationRequest,
    ModelProvider,
    Part,
    ProviderError,
    Turn,
)
from kazer.chat import artifacts, connectors, context, plans
from kazer.chat.generation import GenerationHub, LiveGeneration
from kazer.chat.identity import current_access_token
from kazer.chat.protocols import AttachmentStorage, ChatStorage
from kazer.chat.store import (
    Attachment,
    AttachmentUnavailable,
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
# Biblioteca: filtros aceitos e itens por página.
LIBRARY_KINDS = frozenset({"tudo", "imagem", "documento", "artefato"})
LIBRARY_PAGE = 30
# Conectores por página do catálogo.
CONNECTOR_PAGE = 60
MAX_MEMORY_CHARS = 500
PAGE_MESSAGES = 40
# Título gerado pelo modelo a partir da primeira troca.
TITLE_MAX_WORDS = 7
TITLE_SOURCE_CHARS = 700
_TITLE_PROMPT = (
    "Dê um título curto para esta conversa, em português do Brasil: no máximo "
    f"{TITLE_MAX_WORDS} palavras, sem aspas, sem ponto final, sem emoji e sem a palavra "
    '"conversa". Responda só com o título.'
)
PAGE_CONVERSATIONS = 30
CONTEXT_MESSAGES = 60
ORPHAN_TTL = 24 * 3600
USAGE_TTL = 2 * 24 * 3600

# O consumo acompanha o trabalho real: pensar mais, ler imagem, pesquisar na web
# e arrastar um histórico longo custam mais ao provedor do que um "oi".
UNITS_BASE = 1
UNITS_DEEP = 2
UNITS_WEB = 1
UNITS_IMAGE = 1
UNITS_PDF = 2
UNITS_LONG_PROMPT = 1
UNITS_LONG_HISTORY = 1
LONG_PROMPT_CHARS = 2000
LONG_HISTORY_MESSAGES = 20
MAX_UNITS = 12

PREFERENCE_DEFAULTS: dict[str, Any] = {
    "nickname": "",
    "style": "equilibrado",
    "instructions": "",
    "memory_enabled": True,
    "send_on_enter": True,
    "motion": "sistema",
    "text_size": "m",
    "ambient": True,
    # Plano que a pessoa quis enquanto a cobrança não abre (não dá acesso a nada).
    "wants_plan": "",
}
_CHOICES = {
    "style": {"direto", "equilibrado", "detalhado"},
    "motion": {"sistema", "reduzido", "completo"},
    "text_size": {"p", "m", "g"},
    "wants_plan": {"", "free", "pro", "ultra"},
}
_TEXT_LIMITS = {"nickname": 40, "instructions": 1500}
_BOOLS = {"memory_enabled", "send_on_enter", "ambient"}

_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _cursor(value: str | None) -> tuple[int, str] | None:
    """`"1730300000.abc123"` vira `(1730300000, "abc123")`; lixo vira None."""
    if not value or "." not in value:
        return None
    stamp, _, item = value.partition(".")
    if not stamp.isdigit() or not valid_id(item):
        return None
    return int(stamp), item


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
    images: int = 0
    documents: int = 0
    long_prompt: bool = False
    long_history: bool = False
    # Modo Forja: oficina de código, só nos planos pagos.
    forja: bool = False

    def as_dict(self) -> dict[str, Any]:
        """Gravado junto da mensagem para auditoria de uso."""
        return {
            "model": PUBLIC_MODEL_ID,
            "effort": self.effort,
            "deep": self.deep,
            "web_search": self.web_search,
            "memory": self.memory,
            "forja": self.forja,
            # Guardado com a mensagem para o consumo ser auditável depois.
            "units": self.units,
        }

    @property
    def units(self) -> int:
        """Custo na cota, proporcional ao trabalho que o pedido realmente dá."""
        units = UNITS_BASE
        units += UNITS_DEEP if self.deep else 0
        units += UNITS_WEB if self.web_search else 0
        units += UNITS_IMAGE * self.images
        units += UNITS_PDF * self.documents
        units += UNITS_LONG_PROMPT if self.long_prompt else 0
        units += UNITS_LONG_HISTORY if self.long_history else 0
        return min(units, MAX_UNITS)


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
        store: ChatStorage,
        uploads: AttachmentStorage,
        provider: ModelProvider | None,
        *,
        hourly_units: int = 60,
        daily_units: int = 300,
        max_conversations: int = 100,
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
        self._max_conversations = max_conversations
        self._hub = hub or (GenerationHub(store, provider, clock=clock) if provider else None)
        self._last_purge = 0
        self._owners: set[str] = set()

    def _now(self) -> int:
        return int(self._clock())

    def initialize(self) -> None:
        """Prepara o armazenamento e limpa anexos órfãos (sem derrubar a subida)."""
        try:
            self._store.initialize(self._now())
            self.purge()
        except Exception:  # noqa: BLE001 - o chat avisa sozinho quando o banco volta
            logger.warning("chat.initialize_failed")

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

    def usage_state(self, user_id: str) -> dict[str, Any]:
        """Plano, franquia e horário real de renovação, quando o banco informa."""
        reader = getattr(self._store, "usage_state", None)
        raw: dict[str, Any] = {}
        if reader is not None:
            try:
                raw = reader(user_id) or {}
            except Exception:  # noqa: BLE001 - uso é informativo; não derruba o chat
                logger.warning("chat.usage_state_failed")
        plan = plans.plan_of(raw.get("plan"))
        if not raw:
            # Sem banco com planos (desenvolvimento local): o limite real é a
            # janela configurada no servidor, então é ela que a tela mostra.
            window = self._windows[0]
            counter = getattr(self._store, "used_units", None)
            used = 0
            if counter is not None:
                try:
                    used = counter(user_id, self._now() - window.seconds)
                except Exception:  # noqa: BLE001 - uso é informativo
                    logger.warning("chat.usage_state_failed")
            return {
                "plan": plan.id,
                "plan_name": plan.name,
                "allowance": window.units,
                "consumed": min(used, window.units),
                "window_hours": max(round(window.seconds / 3600), 1),
                "features": plan.public()["features"],
            }
        state: dict[str, Any] = {
            "plan": plan.id,
            "plan_name": plan.name,
            "allowance": (
                int(raw["allowance"]) if raw.get("allowance") is not None else plan.allowance
            ),
            "consumed": int(raw.get("consumed") or 0),
            "window_hours": plans.WINDOW_HOURS,
            "features": plan.public()["features"],
        }
        # Horários só aparecem quando o banco realmente sabe deles.
        for key in ("reset_at", "renews_at"):
            if raw.get(key):
                state[key] = raw[key]
        return state

    def _offer(self, user_id: str) -> dict[str, Any]:
        """Dados do plano para a tela de limite oferecer o upgrade certo."""
        plan = plans.plan_of(self.usage_state(user_id).get("plan"))
        nxt = plans.BY_ID.get("pro") if plan.id == "free" else plans.BY_ID.get("ultra")
        offer: dict[str, Any] = {"plan": plan.id, "plan_name": plan.name}
        if nxt is not None and nxt.id != plan.id:
            offer["upgrade"] = {
                "id": nxt.id,
                "name": nxt.name,
                "price": nxt.monthly_price,
                # Quantas vezes mais uso a pessoa teria no plano de cima,
                # já com a vírgula decimal do português.
                "times": f"{nxt.allowance / plan.allowance:.1f}".replace(".", ","),
            }
        return offer

    def plans(self, user_id: str) -> dict[str, Any]:
        """Catálogo de planos mais o estado de uso de quem está perguntando."""
        return {
            "plans": plans.catalog(),
            "usage": self.usage_state(user_id),
            # Sem cobrança ligada, a interface oferece sem fingir que vende.
            "checkout": False,
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

    # ---------- Biblioteca ----------

    def library(
        self, user_id: str, *, kind: str, before: str | None, limit: int = LIBRARY_PAGE
    ) -> dict[str, Any]:
        """Página da biblioteca: o que a pessoa enviou e o que o KAZER produziu."""
        if kind not in LIBRARY_KINDS:
            raise ChatError("invalid_request", 400)
        cursor = _cursor(before)
        lister = getattr(self._store, "list_library", None)
        if lister is None:
            return {"items": [], "has_more": False, "kinds": sorted(LIBRARY_KINDS)}
        # Pede um a mais para saber se existe próxima página sem contar tudo.
        items = lister(user_id, kind=kind, limit=limit + 1, before=cursor)
        has_more = len(items) > limit
        items = items[:limit]
        return {
            "items": items,
            "has_more": has_more,
            "next": (
                f"{items[-1]['created_at']}.{items[-1]['id']}" if has_more and items else None
            ),
            "kinds": sorted(LIBRARY_KINDS),
        }

    # ---------- Conectores ----------

    def connectors(
        self, user_id: str, *, query: str = "", category: str = "", page: int = 0
    ) -> dict[str, Any]:
        """Catálogo com o que o plano desta conta pode fazer em cada conector."""
        if len(query) > 80 or (category and category not in connectors.CATEGORIES):
            raise ChatError("invalid_request", 400)
        page = max(page, 0)
        features = self.usage_state(user_id).get("features") or {}
        found, total = connectors.search(
            query, category, limit=CONNECTOR_PAGE, offset=page * CONNECTOR_PAGE
        )
        return {
            "items": [item.public(features) for item in found],
            "total": total,
            "page": page,
            "has_more": (page + 1) * CONNECTOR_PAGE < total,
            "categories": list(connectors.CATEGORIES),
            # Nenhuma conexão existe ainda; a interface diz isso em vez de
            # oferecer um botão que não liga nada.
            "connecting_open": False,
            "limit": int(features.get("connector_limit") or 0),
        }

    def artifact(self, user_id: str, artifact_id: str) -> dict[str, Any]:
        """Conteúdo de um artefato da própria conta."""
        if not valid_id(artifact_id):
            raise ChatError("not_found", 404)
        reader = getattr(self._store, "get_artifact", None)
        item = None if reader is None else reader(user_id, artifact_id)
        if item is None:
            raise ChatError("not_found", 404)
        data: dict[str, Any] = item.public()
        return data

    def delete_artifact(self, user_id: str, artifact_id: str) -> None:
        """Apaga um artefato da própria conta."""
        if not valid_id(artifact_id):
            raise ChatError("not_found", 404)
        remover = getattr(self._store, "delete_artifact", None)
        if remover is None or not remover(user_id, artifact_id):
            raise ChatError("not_found", 404)

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

    def _options(
        self, data: dict[str, Any], memory_enabled: bool, user_id: str = ""
    ) -> SendOptions:
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
        forja = data.get("forja", False)
        if not isinstance(forja, bool):
            raise ChatError("invalid_request", 400)
        if forja and user_id and not self._allows(user_id, "coder"):
            raise ChatError("plan_required", 402, feature="forja", **self._offer(user_id))
        return SendOptions(
            effort=EFFORTS[effort],
            deep=deep,
            web_search=web,
            memory=memory and memory_enabled,
            forja=forja,
        )

    def _allows(self, user_id: str, feature: str) -> bool:
        """O plano da conta libera este recurso?"""
        features = self.usage_state(user_id).get("features") or {}
        return bool(features.get(feature))

    def _weigh(
        self,
        options: SendOptions,
        user_id: str,
        content: str,
        attachment_ids: Sequence[str],
        conversation_id: str | None,
    ) -> SendOptions:
        """Mede a complexidade do pedido para a cota acompanhar o trabalho real."""
        images = documents = 0
        for attachment_id in attachment_ids:
            attachment = self._store.get_attachment(user_id, attachment_id)
            if attachment is None:
                continue
            if attachment.kind == "image":
                images += 1
            elif attachment.kind == "pdf":
                documents += 1
        long_history = False
        if conversation_id:
            page = self._store.list_messages(user_id, conversation_id, limit=1)
            if page is not None and page[0]:
                long_history = page[0][-1].seq >= LONG_HISTORY_MESSAGES
        return replace(
            options,
            images=images,
            documents=documents,
            long_prompt=len(content) >= LONG_PROMPT_CHARS,
            long_history=long_history,
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
        options = self._weigh(
            self._options(data, prefs["memory_enabled"], user_id),
            user_id,
            content,
            attachment_ids,
            conversation_id,
        )
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
            raise ChatError(
                "usage_limit", 429, retry_after=wait, reset_at=exc.reset_at, **self._offer(user_id)
            ) from None
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
        # Resposta pronta: os artefatos entram na Biblioteca e, se a conversa
        # acabou de nascer, o próprio modelo dá nome a ela.
        asked = content or (pending[0].name if pending else "")
        on_complete = partial(
            self._finish_reply, question=asked, name_it=exchange.user_message.seq == 1
        )
        live = self._hub.start(
            user_id,
            exchange.conversation.id,
            exchange.reply.id,
            request,
            access_token=current_access_token(),
            on_complete=on_complete,
        )
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
            forja=bool(current.options.get("forja", False)),
        )
        caps = self._provider.capabilities
        if (options.deep and not caps.deep) or (options.web_search and not caps.web_search):
            options = replace(
                options,
                deep=options.deep and caps.deep,
                web_search=options.web_search and caps.web_search,
            )
        if not self._hub.try_reserve():
            raise ChatError("capacity", 503, retry_after=10)
        try:
            restarted = self._store.restart_reply(
                user_id, reply_id, units=options.units, windows=self._windows, now=self._now()
            )
        except LimitReached as exc:
            self._hub.release()
            wait = max(exc.reset_at - self._now(), 1)
            raise ChatError(
                "usage_limit", 429, retry_after=wait, reset_at=exc.reset_at, **self._offer(user_id)
            ) from None
        except BaseException:
            self._hub.release()
            raise
        if restarted is None:
            self._hub.release()
            raise ChatError("not_retryable", 409)
        question, reply = restarted
        prefs = self.preferences(user_id)
        options = replace(options, memory=options.memory and prefs["memory_enabled"])
        request = self._request(user_id, question, options, prefs, timezone)
        live = self._hub.start(
            user_id,
            reply.conversation_id,
            reply.id,
            request,
            access_token=current_access_token(),
        )
        return reply, live

    def _title_from_model(self, question: str, answer: str) -> str | None:
        """Pede ao modelo um título curto; None se não der (nunca trava o chat)."""
        provider = self._provider
        if provider is None:
            return None
        turn = Turn(
            "user",
            (
                Part(
                    "text",
                    text=f"Pergunta:\n{question[:TITLE_SOURCE_CHARS]}\n\n"
                    f"Resposta:\n{answer[:TITLE_SOURCE_CHARS]}",
                ),
            ),
        )
        pieces: list[str] = []
        try:
            for event in provider.stream(
                GenerationRequest(system=_TITLE_PROMPT, turns=(turn,), effort="low"),
                CancelToken(),
            ):
                if event.kind == "text":
                    pieces.append(event.text)
                if sum(len(piece) for piece in pieces) > 200:
                    break
        except ProviderError:
            return None
        title = " ".join("".join(pieces).split()).strip(" \"'`.:-—")
        if not title:
            return None
        words = title.split(" ")
        if len(words) > TITLE_MAX_WORDS:
            title = " ".join(words[:TITLE_MAX_WORDS])
        return title[:MAX_TITLE_CHARS]

    def _finish_reply(self, live: Any, answer: str, question: str, name_it: bool) -> None:
        """Depois da resposta pronta: guarda os artefatos e dá nome à conversa."""
        self._save_artifacts(live, answer)
        if name_it:
            self._name_conversation(live, answer, question)

    def _save_artifacts(self, live: Any, answer: str) -> None:
        """Extrai os artefatos da resposta e avisa a interface do que apareceu."""
        drafts = artifacts.extract(answer)
        if not drafts:
            return
        saver = getattr(self._store, "save_artifacts", None)
        if saver is None:
            return
        try:
            saved = saver(
                live.user_id,
                live.conversation_id,
                live.reply_id,
                [(d.kind, d.title, d.language, d.content) for d in drafts],
                self._now(),
            )
        except Exception:  # noqa: BLE001 - biblioteca não pode derrubar a resposta
            logger.exception("chat.artifacts_failed")
            return
        live.push(
            {
                "type": "artifacts",
                "reply_id": live.reply_id,
                "items": [item.public(body=False) for item in saved],
            }
        )

    def _name_conversation(self, live: Any, answer: str, question: str) -> None:
        """Renomeia a conversa com o título do modelo e avisa quem está ouvindo."""
        title = self._title_from_model(question, answer)
        if not title:
            return
        if not self._store.rename_conversation(live.user_id, live.conversation_id, title):
            return
        live.push({"type": "title", "conversation_id": live.conversation_id, "title": title})

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
            forja=options.forja,
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

    def ensure_owner(self, user_id: str, email: str, created_at: int) -> None:
        """Contas externas (Supabase) ganham a linha local de posse na primeira visita."""
        key = f"{user_id}:{email}"
        if key in self._owners:
            return
        self._store.ensure_owner(user_id, email, created_at)
        self._owners.add(key)

    def forget_user(self, user_id: str) -> None:
        """Depois de excluir a conta: apaga o chat local em cascata e os arquivos."""
        self._store.delete_owner(user_id)
        self._owners = {key for key in self._owners if not key.startswith(f"{user_id}:")}
        self._uploads.delete_user(user_id)
