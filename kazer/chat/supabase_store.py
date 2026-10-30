"""Chat guardado no Postgres do Supabase, pelas funções da migração.

Tudo passa por funções `kazer_*` do banco, nunca por SQL montado aqui. Elas
resolvem a conta pelo JWT da própria pessoa (`auth.uid()`), então um erro neste
arquivo não consegue ler nem escrever conversa de outra conta. A chave de
serviço só entra quando não há requisição em curso — a thread que gera a
resposta — e nesse caso a conta vai explícita.

Anexos ficam num bucket privado (`kazer-anexos`), numa pasta por conta.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from typing import Any

import httpx

from kazer.chat.identity import current_access_token
from kazer.chat.store import (
    Artifact,
    Attachment,
    AttachmentUnavailable,
    Connection,
    Conversation,
    ConversationMissing,
    Exchange,
    LimitReached,
    Memory,
    Message,
    Skill,
    UsageWindow,
)

logger = logging.getLogger("kazer.chat.supabase")


def _connection(row: dict[str, Any]) -> Connection:
    """Linha do Postgres para o modelo; url e token só vêm na função do segredo."""
    tools = row.get("tools")
    return Connection(
        str(row["id"]),
        str(row["connector_id"]),
        str(row["name"]),
        str(row.get("url") or ""),
        str(row.get("token") or ""),
        tools if isinstance(tools, list) else [],
        bool(row.get("enabled")),
        int(row.get("created_at") or 0),
        int(row.get("created_at") or 0),
    )


def _skill(row: dict[str, Any]) -> Skill:
    return Skill(
        str(row["id"]),
        str(row["name"]),
        str(row["description"]),
        str(row.get("instructions") or ""),
        bool(row.get("enabled")),
        bool(row.get("shared")),
        str(row.get("origin") or "propria"),
        int(row.get("created_at") or 0),
        int(row.get("updated_at") or 0),
    )


def _artifact(row: dict[str, Any]) -> Artifact:
    """Linha do Postgres (já em JSON) para o modelo do chat."""
    return Artifact(
        str(row["id"]),
        str(row["kind"]),
        str(row["title"]),
        str(row.get("language") or ""),
        str(row.get("content") or ""),
        row.get("conversation_id"),
        row.get("message_id"),
        int(row.get("created_at") or 0),
        int(row.get("size") or 0),
    )

BUCKET = "kazer-anexos"
MAX_CONVERSATIONS = 100
TIMEOUT = 15.0


class StorageUnavailable(RuntimeError):
    """Banco ou armazenamento do chat fora do ar; a interface avisa com honestidade.

    `not_migrated` separa dois problemas que a pessoa resolve de jeitos
    diferentes: o banco está no ar mas ainda não recebeu as migrações (a função
    chamada não existe) ou ele está fora do ar de verdade.
    """

    def __init__(self, message: str, *, not_migrated: bool = False) -> None:
        super().__init__(message)
        self.not_migrated = not_migrated


def _conversation(data: dict[str, Any]) -> Conversation:
    return Conversation(
        id=str(data["id"]),
        title=str(data.get("title") or "Nova conversa"),
        created_at=int(data.get("created_at") or 0),
        updated_at=int(data.get("updated_at") or 0),
    )


def _attachment(data: dict[str, Any], user_id: str, message_id: str | None = None) -> Attachment:
    return Attachment(
        id=str(data["id"]),
        user_id=user_id,
        message_id=message_id if message_id is not None else data.get("message_id"),
        kind=str(data.get("kind") or "file"),
        media_type=str(data.get("media_type") or "application/octet-stream"),
        name=str(data.get("name") or "arquivo"),
        size=int(data.get("size") or 0),
        created_at=int(data.get("created_at") or 0),
    )


def _message(data: dict[str, Any], user_id: str) -> Message:
    return Message(
        id=str(data["id"]),
        conversation_id=str(data["conversation_id"]),
        seq=int(data["seq"]),
        role=str(data["role"]),
        content=str(data.get("content") or ""),
        thinking=str(data.get("thinking") or ""),
        status=str(data.get("status") or "complete"),
        error_code=data.get("error"),
        stop_reason=data.get("stop"),
        options=data.get("options") or {},
        created_at=int(data.get("created_at") or 0),
        finished_at=data.get("finished_at"),
        attachments=tuple(
            _attachment(item, user_id, str(data["id"])) for item in data.get("attachments") or []
        ),
        artifacts=tuple(_artifact(item) for item in data.get("artifacts") or []),
    )


class SupabaseChatStore:
    """Mesma interface do store local, falando com o Postgres do Supabase."""

    def __init__(
        self,
        url: str,
        publishable_key: str,
        *,
        service_role_key: str | None = None,
        client: httpx.Client | None = None,
        max_conversations: int = MAX_CONVERSATIONS,
    ) -> None:
        """A chave publicável acompanha toda chamada; a de serviço é opcional."""
        self._base = url.rstrip("/")
        self._key = publishable_key
        self._service_key = service_role_key
        self._client = client or httpx.Client(timeout=TIMEOUT)
        self._max_conversations = max_conversations

    def __repr__(self) -> str:
        """Sem chaves."""
        return "SupabaseChatStore()"

    # ---------- Transporte ----------

    def _auth(self) -> tuple[str, str | None]:
        """Token da requisição; sem ela, a chave de serviço (thread de geração)."""
        token = current_access_token()
        if token:
            return token, None
        if self._service_key:
            return self._service_key, self._service_key
        raise StorageUnavailable("sem credencial para falar com o banco do chat")

    def _rpc(self, name: str, params: dict[str, Any] | None = None) -> Any:
        bearer, service = self._auth()
        headers = {
            "apikey": service or self._key,
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
        }
        try:
            response = self._client.post(
                f"{self._base}/rest/v1/rpc/{name}", headers=headers, json=params or {}
            )
        except httpx.HTTPError:
            logger.warning("chat.store_unreachable", extra={"rpc": name})
            raise StorageUnavailable("banco do chat inacessível") from None
        if response.status_code >= 400:
            # O corpo pode conter o texto da mensagem: nunca vai para o log.
            logger.warning("chat.store_error", extra={"rpc": name, "status": response.status_code})
            # PostgREST responde 404 (PGRST202) quando a função não existe: o
            # projeto está no ar, mas as migrações do KAZER ainda não foram aplicadas.
            raise StorageUnavailable(
                f"banco do chat recusou {name}", not_migrated=response.status_code == 404
            )
        try:
            return response.json()
        except ValueError:
            return None

    def _storage(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        bearer, service = self._auth()
        headers = {"apikey": service or self._key, "Authorization": f"Bearer {bearer}"}
        headers.update(kwargs.pop("headers", {}))
        try:
            return self._client.request(
                method, f"{self._base}/storage/v1/object/{path}", headers=headers, **kwargs
            )
        except httpx.HTTPError:
            raise StorageUnavailable("armazenamento de anexos inacessível") from None

    @staticmethod
    def _path(user_id: str, attachment_id: str) -> str:
        return f"{BUCKET}/{user_id}/{attachment_id}"

    # ---------- Ciclo de vida ----------

    def initialize(self, now: int) -> None:
        """O schema vem das migrações; nada para criar em tempo de execução."""

    def ensure_owner(self, user_id: str, email: str, created_at: int) -> None:
        """A conta já existe em `auth.users`: nada a espelhar."""

    def delete_owner(self, user_id: str) -> None:
        """Excluir a conta no Auth apaga o chat em cascata."""

    # ---------- Conversas ----------

    def get_conversation(self, user_id: str, conversation_id: str) -> Conversation | None:
        """Conversa da própria conta."""
        data = self._rpc("kazer_conversation", {"p_conversation_id": conversation_id})
        return None if not data else _conversation(data)

    def list_conversations(
        self,
        user_id: str,
        *,
        limit: int,
        before: tuple[int, str] | None = None,
        query: str = "",
    ) -> list[Conversation]:
        """Página do histórico, mais recentes primeiro."""
        params: dict[str, Any] = {"p_limit": limit, "p_query": query or None}
        if before is not None:
            params["p_before_updated"] = _iso(before[0])
            params["p_before_id"] = before[1]
        rows = self._rpc("kazer_conversations", params) or []
        return [_conversation(row) for row in rows]

    def rename_conversation(self, user_id: str, conversation_id: str, title: str) -> bool:
        """Troca o título."""
        data = self._rpc(
            "kazer_rename_conversation",
            {"p_conversation_id": conversation_id, "p_title": title},
        )
        return bool(data)

    def delete_conversation(self, user_id: str, conversation_id: str) -> list[str] | None:
        """Apaga a conversa; devolve os anexos para sair do armazenamento."""
        data = self._rpc("kazer_delete_conversation", {"p_conversation_id": conversation_id})
        if not data:
            return None
        return [str(path) for path in data.get("storage_paths") or []]

    def delete_all_conversations(self, user_id: str) -> list[str]:
        """Apaga o histórico inteiro."""
        data = self._rpc("kazer_delete_all_conversations") or {}
        return [str(path) for path in data.get("storage_paths") or []]

    # ---------- Mensagens ----------

    def list_messages(
        self, user_id: str, conversation_id: str, *, limit: int, before_seq: int | None = None
    ) -> tuple[list[Message], bool] | None:
        """Página de mensagens e se há anteriores."""
        data = self._rpc(
            "kazer_messages",
            {"p_conversation_id": conversation_id, "p_limit": limit, "p_before_seq": before_seq},
        )
        if not data:
            return None
        return [_message(row, user_id) for row in data.get("items") or []], bool(
            data.get("has_more")
        )

    def context_messages(self, conversation_id: str, up_to_seq: int, limit: int) -> list[Message]:
        """Histórico recente para montar o contexto do modelo."""
        rows = (
            self._rpc(
                "kazer_context_messages",
                {
                    "p_conversation_id": conversation_id,
                    "p_up_to_seq": up_to_seq,
                    "p_limit": limit,
                },
            )
            or []
        )
        return [_message(row, "") for row in rows]

    def get_message(self, user_id: str, message_id: str) -> Message | None:
        """Mensagem da própria conta."""
        data = self._rpc("kazer_message", {"p_message_id": message_id})
        return None if not data else _message(data, user_id)

    def find_exchange(self, user_id: str, client_id: str) -> Exchange | None:
        """Troca já registrada com este `client_id` (reenvio do mesmo pedido)."""
        data = self._rpc("kazer_find_exchange", {"p_client_id": client_id})
        return None if not data else self._exchange(data, user_id)

    def _exchange(self, data: dict[str, Any], user_id: str) -> Exchange:
        return Exchange(
            conversation=_conversation(data["conversation"]),
            user_message=_message(data["message"], user_id),
            reply=_message(data["reply"], user_id),
            duplicate=bool(data.get("duplicate")),
        )

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
    ) -> Exchange:
        """Grava a pergunta, reserva a resposta, debita a cota e poda o histórico."""
        data = self._rpc(
            "kazer_begin_exchange",
            {
                "p_conversation_id": conversation_id,
                "p_title": title,
                "p_content": content,
                "p_client_id": client_id,
                "p_attachment_ids": list(attachment_ids),
                "p_options": options,
                "p_units": units,
                "p_model": options.get("model"),
                "p_max_conversations": self._max_conversations,
            },
        )
        if not isinstance(data, dict):
            raise StorageUnavailable("resposta inesperada do banco do chat")
        error = data.get("error")
        if error == "usage_limit":
            raise LimitReached(_epoch(data.get("usage", {}).get("reset_at")))
        if error == "not_found":
            raise ConversationMissing()
        if error == "attachment_invalid":
            raise AttachmentUnavailable()
        # Os anexos das conversas podadas saem do armazenamento.
        for path in data.get("pruned_storage_paths") or []:
            self._delete_path(str(path))
        exchange = self._exchange(data, user_id)
        request_id = data.get("request_id")
        if request_id:
            object.__setattr__(exchange, "request_id", str(request_id))
        return exchange

    def restart_reply(
        self,
        user_id: str,
        reply_id: str,
        *,
        units: int,
        windows: Sequence[UsageWindow],
        now: int,
    ) -> tuple[Message, Message] | None:
        """Reabre a última resposta com erro ou interrompida."""
        data = self._rpc("kazer_restart_reply", {"p_reply_id": reply_id, "p_units": units})
        if not data:
            return None
        if data.get("error") == "usage_limit":
            raise LimitReached(_epoch(data.get("usage", {}).get("reset_at")))
        return _message(data["question"], user_id), _message(data["reply"], user_id)

    def update_reply(
        self,
        reply_id: str,
        *,
        content: str,
        thinking: str,
        status: str | None = None,
        error_code: str | None = None,
        stop_reason: str | None = None,
        finished_at: int | None = None,
        user_id: str | None = None,
    ) -> None:
        """Grava o progresso da resposta (a thread de geração passa a conta)."""
        self._rpc(
            "kazer_update_reply",
            {
                "p_reply_id": reply_id,
                "p_content": content,
                "p_thinking": thinking,
                "p_status": status,
                "p_error_code": error_code,
                "p_stop_reason": stop_reason,
                "p_user_id": user_id,
            },
        )

    # ---------- Anexos ----------

    @staticmethod
    def new_attachment_id() -> str:
        """O banco guarda uuid; o mesmo id vira o caminho no bucket."""
        return str(uuid.uuid4())

    def create_attachment(self, attachment: Attachment) -> None:
        """Registra o anexo (os bytes vão pelo armazenamento do Supabase)."""
        self._rpc(
            "kazer_create_attachment",
            {
                "p_id": attachment.id,
                "p_kind": attachment.kind,
                "p_media_type": attachment.media_type,
                "p_name": attachment.name,
                "p_size": attachment.size,
                "p_storage_path": f"{attachment.user_id}/{attachment.id}",
            },
        )

    def get_attachment(self, user_id: str, attachment_id: str) -> Attachment | None:
        """Metadados do anexo da própria conta."""
        data = self._rpc("kazer_attachment", {"p_attachment_id": attachment_id})
        return None if not data else _attachment(data, user_id)

    def delete_pending_attachment(self, user_id: str, attachment_id: str) -> bool:
        """Remove anexo ainda não enviado."""
        data = self._rpc("kazer_discard_attachment", {"p_attachment_id": attachment_id})
        if not data:
            return False
        self._delete_path(str(data.get("storage_path") or ""))
        return True

    def storage_used(self, user_id: str) -> tuple[int, int]:
        """Bytes guardados e anexos pendentes."""
        data = self._rpc("kazer_storage_used") or {}
        return int(data.get("used") or 0), int(data.get("pending") or 0)

    def purge_orphan_attachments(self, older_than: int) -> list[tuple[str, str]]:
        """Limpeza feita pelo banco; os caminhos devolvidos saem do armazenamento.

        Roda dentro de uma requisição (é lá que existe credencial); na subida do
        servidor não há nada a fazer.
        """
        try:
            data = self._rpc("kazer_purge") or {}
        except StorageUnavailable:
            return []
        for path in data.get("storage_paths") or []:
            self._delete_path(str(path))
        return []

    def purge_usage(self, older_than: int) -> None:
        """Incluída no `kazer_purge`."""

    def _delete_path(self, path: str) -> None:
        if not path:
            return
        try:
            self._storage("DELETE", f"{BUCKET}/{path}")
        except StorageUnavailable:
            logger.warning("chat.attachment_delete_failed")

    # ---------- Preferências, memórias e exportação ----------

    def get_preferences(self, user_id: str) -> dict[str, Any]:
        """Preferências salvas."""
        data = self._rpc("kazer_get_preferences")
        return data if isinstance(data, dict) else {}

    def save_preferences(self, user_id: str, data: dict[str, Any], now: int) -> None:
        """Substitui as preferências."""
        self._rpc("kazer_save_preferences", {"p_data": data})

    # ---------- Conectores ligados ----------

    def list_connections(self, user_id: str) -> list[Connection]:
        """Conectores ligados; sem endereço nem credencial (a função não devolve)."""
        rows = self._rpc("kazer_connections") or []
        return [_connection(row) for row in rows]

    def get_connection(self, user_id: str, connection_id: str) -> Connection | None:
        """Conexão com credencial: o único caminho até ela, e só da própria conta."""
        data = self._rpc("kazer_connection_secret", {"p_id": connection_id})
        return None if not data else _connection(data)

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
    ) -> Connection | None:
        """Liga (ou religa) um conector; None quando o plano não permite mais."""
        data = self._rpc(
            "kazer_save_connection",
            {
                "p_connector_id": connector_id,
                "p_name": name,
                "p_url": url,
                "p_token": token,
                "p_tools": tools,
                "p_max": max_count,
            },
        )
        return None if not data else _connection(data)

    def set_connection_enabled(self, user_id: str, connection_id: str, enabled: bool) -> bool:
        """Liga ou desliga sem perder a credencial."""
        return bool(
            self._rpc("kazer_set_connection", {"p_id": connection_id, "p_enabled": enabled})
        )

    def delete_connection(self, user_id: str, connection_id: str) -> bool:
        """Desliga o conector e apaga a credencial."""
        return bool(self._rpc("kazer_delete_connection", {"p_id": connection_id}))

    # ---------- Projetos ----------

    def list_skills(self, user_id: str) -> list[Skill]:
        """Habilidades da conta, com as instruções (o chat precisa delas)."""
        return [_skill(row) for row in self._rpc("kazer_skills") or []]

    def list_shared_skills(self, *, query: str = "", limit: int = 40) -> list[Skill]:
        """Catálogo aberto: o que qualquer pessoa publicou."""
        rows = self._rpc("kazer_shared_skills", {"p_query": query, "p_limit": limit}) or []
        return [_skill(row) for row in rows]

    def get_skill(self, skill_id: str, user_id: str | None = None) -> Skill | None:
        """Habilidade por id; sem `user_id`, só se ela for pública."""
        data = self._rpc("kazer_skill", {"p_id": skill_id, "p_mine": bool(user_id)})
        return None if not data else _skill(data)

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
    ) -> Skill | None:
        """Cria a habilidade; None quando a conta chegou ao limite."""
        data = self._rpc(
            "kazer_create_skill",
            {
                "p_name": name,
                "p_description": description,
                "p_instructions": instructions,
                "p_origin": origin,
                "p_max": max_count,
            },
        )
        return None if not data else _skill(data)

    def update_skill(
        self,
        user_id: str,
        skill_id: str,
        now: int,
        *,
        name: str | None = None,
        description: str | None = None,
        instructions: str | None = None,
        enabled: bool | None = None,
        shared: bool | None = None,
    ) -> bool:
        """Altera só os campos informados."""
        return bool(
            self._rpc(
                "kazer_update_skill",
                {
                    "p_id": skill_id,
                    "p_name": name,
                    "p_description": description,
                    "p_instructions": instructions,
                    "p_enabled": enabled,
                    "p_shared": shared,
                },
            )
        )

    def delete_skill(self, user_id: str, skill_id: str) -> bool:
        """Apaga uma habilidade da própria conta."""
        return bool(self._rpc("kazer_delete_skill", {"p_id": skill_id}))

    # ---------- Biblioteca e artefatos ----------

    def save_artifacts(
        self,
        user_id: str,
        conversation_id: str,
        message_id: str,
        drafts: Sequence[tuple[str, str, str, str]],
        now: int,
    ) -> list[Artifact]:
        """Grava os artefatos de uma resposta (a gravação pode vir da thread)."""
        rows = (
            self._rpc(
                "kazer_save_artifacts",
                {
                    "p_conversation_id": conversation_id,
                    "p_message_id": message_id,
                    "p_items": [
                        {"kind": kind, "title": title, "language": language, "content": content}
                        for kind, title, language, content in drafts
                    ],
                    "p_user_id": user_id,
                },
            )
            or []
        )
        return [_artifact(row) for row in rows]

    def get_artifact(self, user_id: str, artifact_id: str) -> Artifact | None:
        """Artefato da própria conta, com o conteúdo."""
        data = self._rpc("kazer_artifact", {"p_id": artifact_id})
        return None if not data else _artifact(data)

    def delete_artifact(self, user_id: str, artifact_id: str) -> bool:
        """Apaga um artefato da própria conta."""
        return bool(self._rpc("kazer_delete_artifact", {"p_id": artifact_id}))

    def list_library(
        self, user_id: str, *, kind: str, limit: int, before: tuple[int, str] | None = None
    ) -> list[dict[str, Any]]:
        """Página da biblioteca: enviados e produzidos, mais recentes primeiro."""
        rows = self._rpc(
            "kazer_library",
            {
                "p_kind": kind,
                "p_limit": limit,
                "p_before_at": None if before is None else before[0],
                "p_before_id": None if before is None else before[1],
            },
        )
        return list(rows or [])

    def list_memories(self, user_id: str) -> list[Memory]:
        """Memórias da conta."""
        rows = self._rpc("kazer_list_memories") or []
        return [
            Memory(str(row["id"]), str(row["content"]), int(row.get("created_at") or 0))
            for row in rows
        ]

    def add_memory(self, user_id: str, content: str, now: int, max_count: int) -> Memory | None:
        """Salva uma memória; None quando o limite foi atingido."""
        data = self._rpc("kazer_add_memory", {"p_content": content, "p_max": max_count})
        if not data:
            return None
        return Memory(str(data["id"]), str(data["content"]), int(data.get("created_at") or 0))

    def delete_memory(self, user_id: str, memory_id: str) -> bool:
        """Remove uma memória."""
        return bool(self._rpc("kazer_delete_memory", {"p_memory_id": memory_id}))

    def delete_all_memories(self, user_id: str) -> None:
        """Esquece tudo."""
        self._rpc("kazer_clear_memories")

    def export(self, user_id: str) -> dict[str, Any]:
        """Cópia legível de tudo o que a conta guarda no chat."""
        data = self._rpc("kazer_export")
        return data if isinstance(data, dict) else {"conversations": [], "memories": []}

    # ---------- Uso e plano ----------

    def usage_state(self, user_id: str) -> dict[str, Any]:
        """Plano, franquia, consumo e horário real de renovação."""
        data = self._rpc("kazer_usage_state")
        return data if isinstance(data, dict) else {}

    def settle_usage(
        self, request_id: str, units: int, status: str, user_id: str | None = None
    ) -> None:
        """Ajusta o consumo para o real e devolve a reserva não usada."""
        self._rpc(
            "kazer_settle_usage",
            {
                "p_request_id": request_id,
                "p_final_units": units,
                "p_final_status": status,
                "p_user_id": user_id,
            },
        )


def _iso(epoch: int) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(epoch, UTC).isoformat()


def _epoch(value: Any) -> int:
    from datetime import datetime

    if not isinstance(value, str) or not value:
        return 0
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


class SupabaseUploadStorage:
    """Bytes dos anexos no bucket privado, numa pasta por conta."""

    def __init__(
        self,
        url: str,
        publishable_key: str,
        *,
        service_role_key: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        """Mesma interface do armazenamento em disco."""
        self._store = SupabaseChatStore(
            url, publishable_key, service_role_key=service_role_key, client=client
        )

    def save(self, user_id: str, attachment_id: str, data: bytes) -> None:
        """Grava em `kazer-anexos/<conta>/<anexo>`."""
        response = self._store._storage(
            "POST",
            f"{BUCKET}/{user_id}/{attachment_id}",
            content=data,
            headers={"Content-Type": "application/octet-stream", "x-upsert": "true"},
        )
        if response.status_code >= 400:
            raise StorageUnavailable("não foi possível guardar o anexo")

    def read(self, user_id: str, attachment_id: str) -> bytes | None:
        """Conteúdo do anexo, ou None se já não existir."""
        try:
            response = self._store._storage("GET", f"{BUCKET}/{user_id}/{attachment_id}")
        except StorageUnavailable:
            return None
        return response.content if response.status_code == 200 else None

    def delete(self, user_id: str, attachment_id: str) -> None:
        """Remove um anexo."""
        self._store._delete_path(f"{user_id}/{attachment_id}")

    def delete_user(self, user_id: str) -> None:
        """A exclusão da conta no Auth apaga as linhas; os objetos saem por rotina."""
