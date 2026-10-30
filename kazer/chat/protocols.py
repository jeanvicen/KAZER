"""Contrato que o chat espera do armazenamento.

Duas implementações atendem: `ChatStore` (SQLite local) e `SupabaseChatStore`
(Postgres do Supabase). O serviço fala só com estes protocolos, então trocar de
banco não mexe nas regras do chat.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol

from kazer.chat.store import (
    Artifact,
    Attachment,
    Connection,
    Conversation,
    Exchange,
    Memory,
    Message,
    Project,
    Skill,
    UsageWindow,
)


class ChatStorage(Protocol):
    """Conversas, mensagens, anexos, preferências e memórias de uma conta."""

    def initialize(self, now: int) -> None: ...

    def ensure_owner(self, user_id: str, email: str, created_at: int) -> None: ...

    def delete_owner(self, user_id: str) -> None: ...

    # Conversas
    def get_conversation(self, user_id: str, conversation_id: str) -> Conversation | None: ...

    def list_conversations(
        self,
        user_id: str,
        *,
        limit: int,
        before: tuple[int, str] | None = ...,
        query: str = ...,
    ) -> list[Conversation]: ...

    def rename_conversation(self, user_id: str, conversation_id: str, title: str) -> bool: ...

    def delete_conversation(self, user_id: str, conversation_id: str) -> list[str] | None: ...

    def delete_all_conversations(self, user_id: str) -> list[str]: ...

    # Mensagens
    def list_messages(
        self, user_id: str, conversation_id: str, *, limit: int, before_seq: int | None = ...
    ) -> tuple[list[Message], bool] | None: ...

    def context_messages(
        self, conversation_id: str, up_to_seq: int, limit: int
    ) -> list[Message]: ...

    def get_message(self, user_id: str, message_id: str) -> Message | None: ...

    def find_exchange(self, user_id: str, client_id: str) -> Exchange | None: ...

    def begin_exchange(
        self,
        user_id: str,
        *,
        conversation_id: str | None,
        title: str,
        content: str,
        client_id: str,
        attachment_ids: Sequence[str],
        options: dict[str, Any],
        units: int,
        windows: Sequence[UsageWindow],
        now: int,
    ) -> Exchange: ...

    def restart_reply(
        self, user_id: str, reply_id: str, *, units: int, windows: Sequence[UsageWindow], now: int
    ) -> tuple[Message, Message] | None: ...

    def update_reply(
        self,
        reply_id: str,
        *,
        content: str,
        thinking: str,
        status: str | None = ...,
        error_code: str | None = ...,
        stop_reason: str | None = ...,
        finished_at: int | None = ...,
        user_id: str | None = ...,
    ) -> None: ...

    # Anexos
    def new_attachment_id(self) -> str: ...

    def create_attachment(self, attachment: Attachment) -> None: ...

    def get_attachment(self, user_id: str, attachment_id: str) -> Attachment | None: ...

    def delete_pending_attachment(self, user_id: str, attachment_id: str) -> bool: ...

    def storage_used(self, user_id: str) -> tuple[int, int]: ...

    def purge_orphan_attachments(self, older_than: int) -> list[tuple[str, str]]: ...

    def purge_usage(self, older_than: int) -> None: ...

    # Conectores ligados
    def list_connections(self, user_id: str) -> list[Connection]: ...

    def get_connection(self, user_id: str, connection_id: str) -> Connection | None: ...

    def save_connection(
        self,
        user_id: str,
        *,
        connector_id: str,
        name: str,
        url: str,
        token: str,
        tools: list[dict[str, Any]],
        now: int,
        max_count: int,
    ) -> Connection | None: ...

    def set_connection_enabled(
        self, user_id: str, connection_id: str, enabled: bool
    ) -> bool: ...

    def delete_connection(self, user_id: str, connection_id: str) -> bool: ...

    # Projetos
    def list_projects(
        self, user_id: str, *, archived: bool, query: str = ...
    ) -> list[Project]: ...

    def create_project(
        self, user_id: str, name: str, goal: str, now: int, max_count: int = ...
    ) -> Project | None: ...

    def get_project(self, user_id: str, project_id: str) -> Project | None: ...

    def update_project(
        self,
        user_id: str,
        project_id: str,
        now: int,
        *,
        name: str | None = ...,
        goal: str | None = ...,
        archived: bool | None = ...,
    ) -> bool: ...

    def delete_project(self, user_id: str, project_id: str) -> bool: ...

    def set_conversation_project(
        self, user_id: str, conversation_id: str, project_id: str | None
    ) -> bool: ...

    # Habilidades
    def list_skills(self, user_id: str) -> list[Skill]: ...

    def list_shared_skills(self, *, query: str = ..., limit: int = ...) -> list[Skill]: ...

    def get_skill(self, skill_id: str, user_id: str | None = ...) -> Skill | None: ...

    def create_skill(
        self,
        user_id: str,
        *,
        name: str,
        description: str,
        instructions: str,
        origin: str,
        now: int,
        max_count: int,
    ) -> Skill | None: ...

    def update_skill(
        self,
        user_id: str,
        skill_id: str,
        now: int,
        *,
        name: str | None = ...,
        description: str | None = ...,
        instructions: str | None = ...,
        enabled: bool | None = ...,
        shared: bool | None = ...,
    ) -> bool: ...

    def delete_skill(self, user_id: str, skill_id: str) -> bool: ...

    # Biblioteca e artefatos
    def save_artifacts(
        self,
        user_id: str,
        conversation_id: str,
        message_id: str,
        drafts: Sequence[tuple[str, str, str, str]],
        now: int,
    ) -> list[Artifact]: ...

    def get_artifact(self, user_id: str, artifact_id: str) -> Artifact | None: ...

    def delete_artifact(self, user_id: str, artifact_id: str) -> bool: ...

    def list_library(
        self, user_id: str, *, kind: str, limit: int, before: tuple[int, str] | None = ...
    ) -> list[dict[str, Any]]: ...

    # Preferências, memórias e exportação
    def get_preferences(self, user_id: str) -> dict[str, Any]: ...

    def save_preferences(self, user_id: str, data: dict[str, Any], now: int) -> None: ...

    def list_memories(self, user_id: str) -> list[Memory]: ...

    def add_memory(
        self, user_id: str, content: str, now: int, max_count: int
    ) -> Memory | None: ...

    def delete_memory(self, user_id: str, memory_id: str) -> bool: ...

    def delete_all_memories(self, user_id: str) -> None: ...

    def export(self, user_id: str) -> dict[str, Any]: ...


class AttachmentStorage(Protocol):
    """Bytes dos anexos, sempre separados por conta."""

    def save(self, user_id: str, attachment_id: str, data: bytes) -> None: ...

    def read(self, user_id: str, attachment_id: str) -> bytes | None: ...

    def delete(self, user_id: str, attachment_id: str) -> None: ...

    def delete_user(self, user_id: str) -> None: ...
