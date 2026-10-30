"""Persistência do chat em SQLite, no mesmo banco das contas.

Toda consulta parte do `user_id` derivado da sessão validada no servidor: uma
conversa, mensagem, anexo ou memória de outra conta simplesmente "não existe"
para quem pergunta. Excluir a conta remove tudo em cascata.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Mesma tabela do AuthStore. Com o Supabase Auth, cada conta ganha aqui uma linha
# "sombra" (sem senha) só para a posse e a exclusão em cascata do chat local.
_OWNERS = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    email_verified_at INTEGER
);
"""

_SCHEMA = _OWNERS + """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    project_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL DEFAULT '',
    thinking TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'error', 'stopped')),
    error_code TEXT,
    stop_reason TEXT,
    client_id TEXT,
    options TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE (conversation_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client
    ON messages(conversation_id, client_id) WHERE client_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'text', 'pdf')),
    media_type TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_user ON attachments(user_id, created_at);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message_id);
CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id, created_at);
CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    units INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_user ON usage_events(user_id, created_at);
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('code', 'document', 'diagram', 'image', 'data')),
    title TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_user ON artifacts(user_id, created_at);
CREATE INDEX IF NOT EXISTS artifacts_message ON artifacts(message_id);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at);
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    shared INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'propria',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS skills_user ON skills(user_id, created_at);
CREATE INDEX IF NOT EXISTS skills_shared ON skills(shared, updated_at);
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    tools TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_user_connector
    ON connections(user_id, connector_id);
"""


def new_id() -> str:
    """Identificador aleatório de 96 bits, seguro para URL e para nome de arquivo."""
    return secrets.token_urlsafe(12)


@dataclass(frozen=True, slots=True)
class Conversation:
    """Conversa de uma única conta."""

    id: str
    title: str
    created_at: int
    updated_at: int
    project_id: str | None = None

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador."""
        return {
            "id": self.id,
            "title": self.title,
            "project_id": self.project_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class Attachment:
    """Metadados do anexo; o conteúdo fica em disco privado."""

    id: str
    user_id: str
    message_id: str | None
    kind: str
    media_type: str
    name: str
    size: int
    created_at: int

    def public(self) -> dict[str, Any]:
        """Sem `user_id` nem caminho em disco."""
        return {
            "id": self.id,
            "kind": self.kind,
            "media_type": self.media_type,
            "name": self.name,
            "size": self.size,
        }


@dataclass(frozen=True, slots=True)
class Message:
    """Mensagem de uma conversa (a posse é verificada pela conversa)."""

    id: str
    conversation_id: str
    seq: int
    role: str
    content: str
    thinking: str
    status: str
    error_code: str | None
    stop_reason: str | None
    options: dict[str, Any]
    created_at: int
    finished_at: int | None
    attachments: tuple[Attachment, ...] = field(default=())
    # O que esta resposta rendeu para a Biblioteca (sem o conteúdo).
    artifacts: tuple[Artifact, ...] = field(default=())

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador."""
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "seq": self.seq,
            "role": self.role,
            "content": self.content,
            "thinking": self.thinking,
            "status": self.status,
            "error": self.error_code,
            "stop": self.stop_reason,
            "options": self.options,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "attachments": [attachment.public() for attachment in self.attachments],
            "artifacts": [item.public(body=False) for item in self.artifacts],
        }


@dataclass(frozen=True, slots=True)
class Memory:
    """Memória que a própria pessoa salvou."""

    id: str
    content: str
    created_at: int

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador."""
        return {"id": self.id, "content": self.content, "created_at": self.created_at}


@dataclass(frozen=True, slots=True)
class Connection:
    """Conector ligado a uma conta.

    `token` existe só no servidor: `public()` nunca o devolve, nem o endereço,
    que pode carregar credencial na própria URL.
    """

    id: str
    connector_id: str
    name: str
    url: str
    token: str
    tools: list[dict[str, Any]]
    enabled: bool
    created_at: int
    updated_at: int

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador: sem credencial e sem endereço."""
        return {
            "id": self.id,
            "connector_id": self.connector_id,
            "name": self.name,
            "connected": True,
            "enabled": self.enabled,
            "tools": self.tools,
            "created_at": self.created_at,
        }


@dataclass(frozen=True, slots=True)
class Project:
    """Pasta de conversas em torno de um assunto."""

    id: str
    name: str
    goal: str
    archived: bool
    conversations: int
    created_at: int
    updated_at: int

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador."""
        return {
            "id": self.id,
            "name": self.name,
            "goal": self.goal,
            "archived": self.archived,
            "conversations": self.conversations,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class Skill:
    """Habilidade: instruções que a pessoa escreve e o KAZER segue."""

    id: str
    name: str
    description: str
    instructions: str
    enabled: bool
    shared: bool
    origin: str
    created_at: int
    updated_at: int

    def public(self, *, body: bool = True) -> dict[str, Any]:
        """Formato enviado ao navegador; a listagem vai sem as instruções."""
        data: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "enabled": self.enabled,
            "shared": self.shared,
            "origin": self.origin,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if body:
            data["instructions"] = self.instructions
        return data


@dataclass(frozen=True, slots=True)
class Artifact:
    """Peça que o KAZER produziu e que vive fora da conversa."""

    id: str
    kind: str
    title: str
    language: str
    content: str
    conversation_id: str | None
    message_id: str | None
    created_at: int
    # Tamanho do conteúdo inteiro: a listagem vem sem o conteúdo, então ele não
    # pode ser deduzido do que está em mãos.
    size: int = 0

    def public(self, *, body: bool = True) -> dict[str, Any]:
        """Formato enviado ao navegador; a listagem vai sem o conteúdo."""
        data: dict[str, Any] = {
            "id": self.id,
            "source": "kazer",
            "kind": self.kind,
            "title": self.title,
            "language": self.language,
            "size": self.size or len(self.content),
            "conversation_id": self.conversation_id,
            "message_id": self.message_id,
            "created_at": self.created_at,
        }
        if body:
            data["content"] = self.content
        return data


@dataclass(frozen=True, slots=True)
class Exchange:
    """Pergunta registrada e a resposta reservada (em geração)."""

    conversation: Conversation
    user_message: Message
    reply: Message
    duplicate: bool = False


class LimitReached(Exception):
    """Cota do servidor esgotada; `reset_at` é o instante exato de liberação."""

    def __init__(self, reset_at: int) -> None:
        """`reset_at` em segundos desde a época."""
        super().__init__("usage_limit")
        self.reset_at = reset_at


class AttachmentUnavailable(Exception):
    """Anexo inexistente, de outra conta ou já usado em outra mensagem."""


class ConversationMissing(Exception):
    """Conversa inexistente ou de outra conta (as duas respostas são iguais)."""


@dataclass(frozen=True, slots=True)
class UsageWindow:
    """Janela deslizante de cota em unidades."""

    seconds: int
    units: int


def _library_row(item: Attachment) -> dict[str, Any]:
    """Anexo como item de biblioteca (o `public()` do anexo serve ao compositor)."""
    return {
        **item.public(),
        "source": "pessoa",
        "title": item.name,
        "message_id": item.message_id,
        "created_at": item.created_at,
    }


def _connection(row: sqlite3.Row) -> Connection:
    try:
        tools = json.loads(row["tools"] or "[]")
    except ValueError:
        tools = []
    return Connection(
        row["id"],
        row["connector_id"],
        row["name"],
        row["url"],
        row["token"],
        tools if isinstance(tools, list) else [],
        bool(row["enabled"]),
        row["created_at"],
        row["updated_at"],
    )


def _project(row: sqlite3.Row) -> Project:
    return Project(
        row["id"],
        row["name"],
        row["goal"],
        bool(row["archived"]),
        int(row["total"]),
        row["created_at"],
        row["updated_at"],
    )


def _skill(row: sqlite3.Row) -> Skill:
    return Skill(
        row["id"],
        row["name"],
        row["description"],
        row["instructions"],
        bool(row["enabled"]),
        bool(row["shared"]),
        row["origin"],
        row["created_at"],
        row["updated_at"],
    )


def _artifact(row: sqlite3.Row) -> Artifact:
    return Artifact(
        row["id"],
        row["kind"],
        row["title"],
        row["language"] or "",
        row["content"],
        row["conversation_id"],
        row["message_id"],
        row["created_at"],
        len(row["content"]),
    )


def _conversation(row: sqlite3.Row) -> Conversation:
    keys = row.keys()
    return Conversation(
        row["id"],
        row["title"],
        row["created_at"],
        row["updated_at"],
        row["project_id"] if "project_id" in keys else None,
    )


def _attachment(row: sqlite3.Row) -> Attachment:
    return Attachment(
        row["id"],
        row["user_id"],
        row["message_id"],
        row["kind"],
        row["media_type"],
        row["name"],
        row["size"],
        row["created_at"],
    )


def _message(
    row: sqlite3.Row,
    attachments: Sequence[Attachment] = (),
    artifacts: Sequence[Artifact] = (),
) -> Message:
    try:
        options = json.loads(row["options"] or "{}")
    except ValueError:
        options = {}
    return Message(
        id=row["id"],
        conversation_id=row["conversation_id"],
        seq=row["seq"],
        role=row["role"],
        content=row["content"],
        thinking=row["thinking"],
        status=row["status"],
        error_code=row["error_code"],
        stop_reason=row["stop_reason"],
        options=options if isinstance(options, dict) else {},
        created_at=row["created_at"],
        finished_at=row["finished_at"],
        attachments=tuple(attachments),
        artifacts=tuple(artifacts),
    )


class ChatStore:
    """Repositório síncrono; cada operação abre uma conexão curta e transacional."""

    def __init__(self, path: Path) -> None:
        """Usa o mesmo arquivo do `AuthStore` (as tabelas referenciam `users`)."""
        self._path = path

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
        finally:
            conn.close()

    def initialize(self, now: int) -> None:
        """Cria o esquema e encerra respostas que ficaram pela metade num reinício."""
        conn = sqlite3.connect(self._path, isolation_level=None)
        try:
            conn.executescript(_SCHEMA)
            # Banco criado antes dos projetos: a coluna entra agora, sem perder
            # nada. O índice vem depois dela, nunca dentro do script — um erro
            # no meio do script abortaria a criação de todo o resto.
            columns = {row[1] for row in conn.execute("PRAGMA table_info(conversations)")}
            if "project_id" not in columns:
                conn.execute("ALTER TABLE conversations ADD COLUMN project_id TEXT")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS conversations_project"
                " ON conversations(project_id)"
            )
        finally:
            conn.close()
        with self._transaction() as conn:
            conn.execute(
                "UPDATE messages SET status = 'error', error_code = 'interrupted',"
                " finished_at = ? WHERE status = 'streaming'",
                (now,),
            )

    def ensure_owner(self, user_id: str, email: str, created_at: int) -> None:
        """Garante a linha do dono (contas do Supabase); idempotente."""
        with self._transaction() as conn:
            row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
            if row is not None and row["email"] == email:
                return
            # Mesmo e-mail com outro id = conta antiga já excluída no provedor: some em cascata.
            conn.execute("DELETE FROM users WHERE email = ? AND id != ?", (email, user_id))
            if row is None:
                conn.execute(
                    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, '', ?)",
                    (user_id, email, created_at),
                )
            else:
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))

    def delete_owner(self, user_id: str) -> None:
        """Apaga a conta local e, em cascata, todo o chat dela."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    # ---------- Conversas ----------

    def get_conversation(self, user_id: str, conversation_id: str) -> Conversation | None:
        """Só devolve conversas da própria conta."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
        return None if row is None else _conversation(row)

    def list_conversations(
        self,
        user_id: str,
        *,
        limit: int,
        before: tuple[int, str] | None = None,
        query: str = "",
    ) -> list[Conversation]:
        """Mais recentes primeiro, paginadas por cursor (updated_at, id)."""
        sql = "SELECT * FROM conversations WHERE user_id = ?"
        params: list[Any] = [user_id]
        if before is not None:
            sql += " AND (updated_at < ? OR (updated_at = ? AND id < ?))"
            params += [before[0], before[0], before[1]]
        if query:
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            sql += " AND title LIKE ? ESCAPE '\\'"
            params.append(f"%{escaped}%")
        sql += " ORDER BY updated_at DESC, id DESC LIMIT ?"
        params.append(limit)
        with self._transaction() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_conversation(row) for row in rows]

    def rename_conversation(self, user_id: str, conversation_id: str, title: str) -> bool:
        """Troca o título; False se a conversa não for desta conta."""
        with self._transaction() as conn:
            cursor = conn.execute(
                "UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?",
                (title, conversation_id, user_id),
            )
        return cursor.rowcount == 1

    def delete_conversation(self, user_id: str, conversation_id: str) -> list[str] | None:
        """Apaga conversa, mensagens e anexos; devolve os anexos para remover do disco."""
        with self._transaction() as conn:
            found = conn.execute(
                "SELECT 1 FROM conversations WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
            if found is None:
                return None
            rows = conn.execute(
                "SELECT attachments.id FROM attachments JOIN messages"
                " ON messages.id = attachments.message_id WHERE messages.conversation_id = ?",
                (conversation_id,),
            ).fetchall()
            conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        return [row["id"] for row in rows]

    def delete_all_conversations(self, user_id: str) -> list[str]:
        """Apaga o histórico inteiro da conta; devolve os anexos removidos."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT attachments.id FROM attachments JOIN messages"
                " ON messages.id = attachments.message_id"
                " JOIN conversations ON conversations.id = messages.conversation_id"
                " WHERE conversations.user_id = ?",
                (user_id,),
            ).fetchall()
            conn.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
        return [row["id"] for row in rows]

    # ---------- Mensagens ----------

    def _attachments_for(
        self, conn: sqlite3.Connection, message_ids: Sequence[str]
    ) -> dict[str, list[Attachment]]:
        grouped: dict[str, list[Attachment]] = {}
        if not message_ids:
            return grouped
        marks = ",".join("?" for _ in message_ids)
        rows = conn.execute(
            f"SELECT * FROM attachments WHERE message_id IN ({marks}) ORDER BY created_at, rowid",  # noqa: S608
            list(message_ids),
        ).fetchall()
        for row in rows:
            grouped.setdefault(row["message_id"], []).append(_attachment(row))
        return grouped

    def _artifacts_for(
        self, conn: sqlite3.Connection, message_ids: Sequence[str]
    ) -> dict[str, list[Artifact]]:
        """Artefatos por mensagem, sem o conteúdo (a listagem não precisa dele)."""
        grouped: dict[str, list[Artifact]] = {}
        if not message_ids:
            return grouped
        marks = ",".join("?" for _ in message_ids)
        rows = conn.execute(
            "SELECT id, kind, title, language, LENGTH(content) AS size, conversation_id,"
            f" message_id, created_at FROM artifacts WHERE message_id IN ({marks})"  # noqa: S608
            " ORDER BY created_at, id",
            list(message_ids),
        ).fetchall()
        for row in rows:
            grouped.setdefault(row["message_id"], []).append(
                Artifact(
                    row["id"],
                    row["kind"],
                    row["title"],
                    row["language"] or "",
                    "",
                    row["conversation_id"],
                    row["message_id"],
                    row["created_at"],
                    row["size"],
                )
            )
        return grouped

    def list_messages(
        self, user_id: str, conversation_id: str, *, limit: int, before_seq: int | None = None
    ) -> tuple[list[Message], bool] | None:
        """Página de mensagens (ordem cronológica) e se há mais antigas."""
        with self._transaction() as conn:
            owner = conn.execute(
                "SELECT 1 FROM conversations WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
            if owner is None:
                return None
            sql = "SELECT * FROM messages WHERE conversation_id = ?"
            params: list[Any] = [conversation_id]
            if before_seq is not None:
                sql += " AND seq < ?"
                params.append(before_seq)
            sql += " ORDER BY seq DESC LIMIT ?"
            params.append(limit + 1)
            rows = conn.execute(sql, params).fetchall()
            has_more = len(rows) > limit
            rows = list(reversed(rows[:limit]))
            ids = [row["id"] for row in rows]
            attachments = self._attachments_for(conn, ids)
            made = self._artifacts_for(conn, ids)
        return [
            _message(row, attachments.get(row["id"], ()), made.get(row["id"], ()))
            for row in rows
        ], has_more

    def context_messages(self, conversation_id: str, up_to_seq: int, limit: int) -> list[Message]:
        """Últimas mensagens até `up_to_seq` (inclusive), para montar o contexto do modelo."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? AND seq <= ?"
                " ORDER BY seq DESC LIMIT ?",
                (conversation_id, up_to_seq, limit),
            ).fetchall()
            rows = list(reversed(rows))
            attachments = self._attachments_for(conn, [row["id"] for row in rows])
        return [_message(row, attachments.get(row["id"], ())) for row in rows]

    def get_message(self, user_id: str, message_id: str) -> Message | None:
        """Mensagem da própria conta (posse verificada pela conversa)."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT messages.* FROM messages JOIN conversations"
                " ON conversations.id = messages.conversation_id"
                " WHERE messages.id = ? AND conversations.user_id = ?",
                (message_id, user_id),
            ).fetchone()
            if row is None:
                return None
            attachments = self._attachments_for(conn, [row["id"]])
        return _message(row, attachments.get(row["id"], ()))

    def _usage_check(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        units: int,
        windows: Sequence[UsageWindow],
        now: int,
    ) -> None:
        for window in windows:
            since = now - window.seconds
            used, oldest = conn.execute(
                "SELECT COALESCE(SUM(units), 0), MIN(created_at) FROM usage_events"
                " WHERE user_id = ? AND created_at > ?",
                (user_id, since),
            ).fetchone()
            if used + units <= window.units:
                continue
            # Libera quando eventos suficientes saírem da janela: instante exato do servidor.
            rows = conn.execute(
                "SELECT units, created_at FROM usage_events WHERE user_id = ? AND created_at > ?"
                " ORDER BY created_at",
                (user_id, since),
            ).fetchall()
            excess = used + units - window.units
            reset_at = (oldest or now) + window.seconds
            for row in rows:
                excess -= row["units"]
                reset_at = row["created_at"] + window.seconds
                if excess <= 0:
                    break
            raise LimitReached(reset_at)

    def used_units(self, user_id: str, since: int) -> int:
        """Unidades gastas pela conta desde `since` (base do painel de uso)."""
        with self._transaction() as conn:
            used = conn.execute(
                "SELECT COALESCE(SUM(units), 0) FROM usage_events"
                " WHERE user_id = ? AND created_at > ?",
                (user_id, since),
            ).fetchone()[0]
        return int(used)

    def _find_duplicate(
        self, conn: sqlite3.Connection, user_id: str, client_id: str
    ) -> Exchange | None:
        row = conn.execute(
            "SELECT messages.* FROM messages JOIN conversations"
            " ON conversations.id = messages.conversation_id"
            " WHERE conversations.user_id = ? AND messages.client_id = ?",
            (user_id, client_id),
        ).fetchone()
        if row is None:
            return None
        reply = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? AND seq = ?",
            (row["conversation_id"], row["seq"] + 1),
        ).fetchone()
        conversation = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (row["conversation_id"],)
        ).fetchone()
        if reply is None or conversation is None:
            return None
        attachments = self._attachments_for(conn, [row["id"]])
        return Exchange(
            _conversation(conversation),
            _message(row, attachments.get(row["id"], ())),
            _message(reply),
            duplicate=True,
        )

    def find_exchange(self, user_id: str, client_id: str) -> Exchange | None:
        """Troca já registrada com este `client_id` (idempotência)."""
        with self._transaction() as conn:
            return self._find_duplicate(conn, user_id, client_id)

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
        """Registra a pergunta e reserva a resposta numa única transação.

        Idempotente por `client_id`: repetir o envio devolve a mesma troca sem
        cobrar cota de novo nem gerar outra resposta.
        """
        with self._transaction() as conn:
            duplicate = self._find_duplicate(conn, user_id, client_id)
            if duplicate is not None:
                return duplicate

            if conversation_id is None:
                conversation = Conversation(new_id(), title, now, now)
                conn.execute(
                    "INSERT INTO conversations (id, user_id, title, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (conversation.id, user_id, title, now, now),
                )
                seq = 1
            else:
                row = conn.execute(
                    "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
                    (conversation_id, user_id),
                ).fetchone()
                if row is None:
                    raise ConversationMissing()
                conversation = _conversation(row)
                (last,) = conn.execute(
                    "SELECT COALESCE(MAX(seq), 0) FROM messages WHERE conversation_id = ?",
                    (conversation.id,),
                ).fetchone()
                seq = last + 1

            self._usage_check(conn, user_id, units, windows, now)

            attachments: list[Attachment] = []
            for attachment_id in attachment_ids:
                row = conn.execute(
                    "SELECT * FROM attachments WHERE id = ? AND user_id = ? AND message_id IS NULL",
                    (attachment_id, user_id),
                ).fetchone()
                if row is None:
                    raise AttachmentUnavailable()
                attachments.append(_attachment(row))

            options_json = json.dumps(options, separators=(",", ":"))
            user_message = Message(
                new_id(), conversation.id, seq, "user", content, "", "complete", None, None,
                options, now, now, tuple(attachments),
            )
            reply = Message(
                new_id(), conversation.id, seq + 1, "assistant", "", "", "streaming", None, None,
                options, now, None,
            )
            conn.execute(
                "INSERT INTO messages (id, conversation_id, seq, role, content, status, client_id,"
                " options, created_at, finished_at)"
                " VALUES (?, ?, ?, 'user', ?, 'complete', ?, ?, ?, ?)",
                (user_message.id, conversation.id, seq, content, client_id, options_json, now, now),
            )
            conn.execute(
                "INSERT INTO messages (id, conversation_id, seq, role, status, options, created_at)"
                " VALUES (?, ?, ?, 'assistant', 'streaming', ?, ?)",
                (reply.id, conversation.id, seq + 1, options_json, now),
            )
            for attachment in attachments:
                conn.execute(
                    "UPDATE attachments SET message_id = ? WHERE id = ?",
                    (user_message.id, attachment.id),
                )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation.id)
            )
            conn.execute(
                "INSERT INTO usage_events (user_id, units, created_at) VALUES (?, ?, ?)",
                (user_id, units, now),
            )
        return Exchange(
            Conversation(conversation.id, conversation.title, conversation.created_at, now),
            user_message,
            reply,
        )

    def restart_reply(
        self,
        user_id: str,
        reply_id: str,
        *,
        units: int,
        windows: Sequence[UsageWindow],
        now: int,
    ) -> tuple[Message, Message] | None:
        """Reabre a última resposta com erro ou interrompida para tentar de novo."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT messages.* FROM messages JOIN conversations"
                " ON conversations.id = messages.conversation_id"
                " WHERE messages.id = ? AND conversations.user_id = ?"
                " AND messages.role = 'assistant'"
                " AND messages.status IN ('error', 'stopped')",
                (reply_id, user_id),
            ).fetchone()
            if row is None:
                return None
            (last,) = conn.execute(
                "SELECT MAX(seq) FROM messages WHERE conversation_id = ?",
                (row["conversation_id"],),
            ).fetchone()
            question = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? AND seq = ? AND role = 'user'",
                (row["conversation_id"], row["seq"] - 1),
            ).fetchone()
            if last != row["seq"] or question is None:
                return None
            self._usage_check(conn, user_id, units, windows, now)
            conn.execute(
                "UPDATE messages SET content = '', thinking = '', status = 'streaming',"
                " error_code = NULL, stop_reason = NULL, finished_at = NULL, created_at = ?"
                " WHERE id = ?",
                (now, reply_id),
            )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, row["conversation_id"]),
            )
            conn.execute(
                "INSERT INTO usage_events (user_id, units, created_at) VALUES (?, ?, ?)",
                (user_id, units, now),
            )
            attachments = self._attachments_for(conn, [question["id"]])
            refreshed = conn.execute("SELECT * FROM messages WHERE id = ?", (reply_id,)).fetchone()
        return _message(question, attachments.get(question["id"], ())), _message(refreshed)

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
        """Grava o progresso da resposta (parcial ou final)."""
        with self._transaction() as conn:
            if status is None:
                conn.execute(
                    "UPDATE messages SET content = ?, thinking = ? WHERE id = ?"
                    " AND status = 'streaming'",
                    (content, thinking, reply_id),
                )
            else:
                conn.execute(
                    "UPDATE messages SET content = ?, thinking = ?, status = ?, error_code = ?,"
                    " stop_reason = ?, finished_at = ? WHERE id = ?",
                    (content, thinking, status, error_code, stop_reason, finished_at, reply_id),
                )

    # ---------- Anexos ----------

    @staticmethod
    def new_attachment_id() -> str:
        """Identificador do anexo (o do Supabase é uuid)."""
        return new_id()

    def create_attachment(self, attachment: Attachment) -> None:
        """Registra anexo ainda não enviado (sem mensagem)."""
        with self._transaction() as conn:
            conn.execute(
                "INSERT INTO attachments (id, user_id, message_id, kind, media_type, name, size,"
                " created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
                (
                    attachment.id,
                    attachment.user_id,
                    attachment.kind,
                    attachment.media_type,
                    attachment.name,
                    attachment.size,
                    attachment.created_at,
                ),
            )

    def get_attachment(self, user_id: str, attachment_id: str) -> Attachment | None:
        """Anexo da própria conta."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM attachments WHERE id = ? AND user_id = ?", (attachment_id, user_id)
            ).fetchone()
        return None if row is None else _attachment(row)

    def delete_pending_attachment(self, user_id: str, attachment_id: str) -> bool:
        """Remove anexo que ainda não foi enviado."""
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM attachments WHERE id = ? AND user_id = ? AND message_id IS NULL",
                (attachment_id, user_id),
            )
        return cursor.rowcount == 1

    def storage_used(self, user_id: str) -> tuple[int, int]:
        """Bytes guardados e anexos pendentes da conta."""
        with self._transaction() as conn:
            used, pending = conn.execute(
                "SELECT COALESCE(SUM(size), 0), COALESCE(SUM(message_id IS NULL), 0)"
                " FROM attachments WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        return int(used), int(pending)

    def purge_orphan_attachments(self, older_than: int) -> list[tuple[str, str]]:
        """Anexos enviados ao servidor mas nunca usados numa mensagem."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT id, user_id FROM attachments WHERE message_id IS NULL AND created_at < ?",
                (older_than,),
            ).fetchall()
            conn.execute(
                "DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?",
                (older_than,),
            )
        return [(row["user_id"], row["id"]) for row in rows]

    def purge_usage(self, older_than: int) -> None:
        """Retenção da contagem de uso: só o necessário para as janelas de cota."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM usage_events WHERE created_at < ?", (older_than,))

    # ---------- Preferências e memórias ----------

    def get_preferences(self, user_id: str) -> dict[str, Any]:
        """Preferências salvas (o serviço aplica os padrões e valida)."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT data FROM preferences WHERE user_id = ?", (user_id,)
            ).fetchone()
        if row is None:
            return {}
        try:
            data = json.loads(row["data"])
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def save_preferences(self, user_id: str, data: dict[str, Any], now: int) -> None:
        """Substitui as preferências da conta."""
        with self._transaction() as conn:
            conn.execute(
                "INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET data = excluded.data,"
                " updated_at = excluded.updated_at",
                (user_id, json.dumps(data, separators=(",", ":")), now),
            )

    # ---------- Conectores ligados ----------

    def list_connections(self, user_id: str) -> list[Connection]:
        """Conectores que esta conta ligou."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM connections WHERE user_id = ? ORDER BY created_at, id",
                (user_id,),
            ).fetchall()
        return [_connection(row) for row in rows]

    def get_connection(self, user_id: str, connection_id: str) -> Connection | None:
        """Conexão da própria conta, com credencial (uso interno)."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM connections WHERE id = ? AND user_id = ?",
                (connection_id, user_id),
            ).fetchone()
        return None if row is None else _connection(row)

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
        with self._transaction() as conn:
            existing = conn.execute(
                "SELECT id FROM connections WHERE user_id = ? AND connector_id = ?",
                (user_id, connector_id),
            ).fetchone()
            if existing is None:
                (count,) = conn.execute(
                    "SELECT COUNT(*) FROM connections WHERE user_id = ?", (user_id,)
                ).fetchone()
                if count >= max_count:
                    return None
            item = Connection(
                existing["id"] if existing else new_id(),
                connector_id,
                name,
                url,
                token,
                tools,
                True,
                now,
                now,
            )
            conn.execute(
                "INSERT INTO connections (id, user_id, connector_id, name, url, token, tools,"
                " enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url,"
                " token = excluded.token, tools = excluded.tools, enabled = 1,"
                " updated_at = excluded.updated_at",
                (
                    item.id,
                    user_id,
                    connector_id,
                    name,
                    url,
                    token,
                    json.dumps(tools),
                    now,
                    now,
                ),
            )
        return item

    def set_connection_enabled(self, user_id: str, connection_id: str, enabled: bool) -> bool:
        """Liga ou desliga um conector sem perder a credencial."""
        with self._transaction() as conn:
            changed = conn.execute(
                "UPDATE connections SET enabled = ? WHERE id = ? AND user_id = ?",
                (int(enabled), connection_id, user_id),
            ).rowcount
        return changed > 0

    def delete_connection(self, user_id: str, connection_id: str) -> bool:
        """Desliga o conector e apaga a credencial."""
        with self._transaction() as conn:
            changed = conn.execute(
                "DELETE FROM connections WHERE id = ? AND user_id = ?", (connection_id, user_id)
            ).rowcount
        return changed > 0

    # ---------- Projetos ----------

    def list_projects(self, user_id: str, *, archived: bool, query: str = "") -> list[Project]:
        """Projetos da conta, com quantas conversas cada um guarda."""
        like = f"%{query.lower()}%"
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT p.*, (SELECT COUNT(*) FROM conversations c"
                "   WHERE c.project_id = p.id) AS total"
                " FROM projects p WHERE p.user_id = ? AND p.archived = ?"
                " AND (? = '' OR LOWER(p.name) LIKE ? OR LOWER(p.goal) LIKE ?)"
                " ORDER BY p.updated_at DESC, p.id DESC",
                (user_id, int(archived), query.lower(), like, like),
            ).fetchall()
        return [_project(row) for row in rows]

    def create_project(
        self, user_id: str, name: str, goal: str, now: int, max_count: int = 60
    ) -> Project | None:
        """Cria o projeto; None quando a conta já chegou ao limite."""
        project = Project(new_id(), name, goal, False, 0, now, now)
        with self._transaction() as conn:
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM projects WHERE user_id = ? AND archived = 0", (user_id,)
            ).fetchone()
            if count >= max_count:
                return None
            conn.execute(
                "INSERT INTO projects (id, user_id, name, goal, archived, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, 0, ?, ?)",
                (project.id, user_id, name, goal, now, now),
            )
        return project

    def get_project(self, user_id: str, project_id: str) -> Project | None:
        """Projeto da própria conta."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT p.*, (SELECT COUNT(*) FROM conversations c"
                "   WHERE c.project_id = p.id) AS total"
                " FROM projects p WHERE p.id = ? AND p.user_id = ?",
                (project_id, user_id),
            ).fetchone()
        return None if row is None else _project(row)

    def update_project(
        self,
        user_id: str,
        project_id: str,
        now: int,
        *,
        name: str | None = None,
        goal: str | None = None,
        archived: bool | None = None,
    ) -> bool:
        """Altera só os campos informados."""
        sets: list[str] = ["updated_at = ?"]
        args: list[Any] = [now]
        for column, value in (("name", name), ("goal", goal)):
            if value is not None:
                sets.append(f"{column} = ?")
                args.append(value)
        if archived is not None:
            sets.append("archived = ?")
            args.append(int(archived))
        with self._transaction() as conn:
            changed = conn.execute(
                f"UPDATE projects SET {', '.join(sets)} WHERE id = ? AND user_id = ?",  # noqa: S608
                (*args, project_id, user_id),
            ).rowcount
        return changed > 0

    def delete_project(self, user_id: str, project_id: str) -> bool:
        """Apaga o projeto; as conversas dele continuam, soltas."""
        with self._transaction() as conn:
            conn.execute(
                "UPDATE conversations SET project_id = NULL"
                " WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            )
            changed = conn.execute(
                "DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)
            ).rowcount
        return changed > 0

    def set_conversation_project(
        self, user_id: str, conversation_id: str, project_id: str | None
    ) -> bool:
        """Põe (ou tira) a conversa de um projeto."""
        with self._transaction() as conn:
            if project_id is not None:
                owns = conn.execute(
                    "SELECT 1 FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)
                ).fetchone()
                if owns is None:
                    return False
            changed = conn.execute(
                "UPDATE conversations SET project_id = ? WHERE id = ? AND user_id = ?",
                (project_id, conversation_id, user_id),
            ).rowcount
        return changed > 0

    # ---------- Habilidades ----------

    def list_skills(self, user_id: str) -> list[Skill]:
        """Habilidades da conta, mais recentes primeiro."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM skills WHERE user_id = ? ORDER BY created_at DESC, id DESC",
                (user_id,),
            ).fetchall()
        return [_skill(row) for row in rows]

    def list_shared_skills(self, *, query: str = "", limit: int = 40) -> list[Skill]:
        """Catálogo: habilidades que qualquer pessoa publicou."""
        like = f"%{query.lower()}%"
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM skills WHERE shared = 1"
                " AND (? = '' OR LOWER(name) LIKE ? OR LOWER(description) LIKE ?)"
                " ORDER BY updated_at DESC, id DESC LIMIT ?",
                (query.lower(), like, like, limit),
            ).fetchall()
        return [_skill(row) for row in rows]

    def get_skill(self, skill_id: str, user_id: str | None = None) -> Skill | None:
        """Habilidade por id; sem `user_id`, só se ela for pública."""
        with self._transaction() as conn:
            row = (
                conn.execute(
                    "SELECT * FROM skills WHERE id = ? AND user_id = ?", (skill_id, user_id)
                ).fetchone()
                if user_id
                else conn.execute(
                    "SELECT * FROM skills WHERE id = ? AND shared = 1", (skill_id,)
                ).fetchone()
            )
        return None if row is None else _skill(row)

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
        """Cria a habilidade; None quando a conta já chegou ao limite."""
        skill = Skill(new_id(), name, description, instructions, True, False, origin, now, now)
        with self._transaction() as conn:
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM skills WHERE user_id = ?", (user_id,)
            ).fetchone()
            if count >= max_count:
                return None
            conn.execute(
                "INSERT INTO skills (id, user_id, name, description, instructions, enabled,"
                " shared, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)",
                (skill.id, user_id, name, description, instructions, origin, now, now),
            )
        return skill

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
        sets: list[str] = ["updated_at = ?"]
        args: list[Any] = [now]
        for column, value in (
            ("name", name),
            ("description", description),
            ("instructions", instructions),
        ):
            if value is not None:
                sets.append(f"{column} = ?")
                args.append(value)
        for column, flag in (("enabled", enabled), ("shared", shared)):
            if flag is not None:
                sets.append(f"{column} = ?")
                args.append(int(flag))
        with self._transaction() as conn:
            changed = conn.execute(
                f"UPDATE skills SET {', '.join(sets)} WHERE id = ? AND user_id = ?",  # noqa: S608
                (*args, skill_id, user_id),
            ).rowcount
        return changed > 0

    def delete_skill(self, user_id: str, skill_id: str) -> bool:
        """Apaga uma habilidade da própria conta."""
        with self._transaction() as conn:
            changed = conn.execute(
                "DELETE FROM skills WHERE id = ? AND user_id = ?", (skill_id, user_id)
            ).rowcount
        return changed > 0

    # ---------- Biblioteca e artefatos ----------

    def save_artifacts(
        self,
        user_id: str,
        conversation_id: str,
        message_id: str,
        drafts: Sequence[tuple[str, str, str, str]],
        now: int,
    ) -> list[Artifact]:
        """Grava os artefatos de uma resposta; repetir a mesma resposta não duplica."""
        saved: list[Artifact] = []
        with self._transaction() as conn:
            # A resposta pode ser gerada de novo: os artefatos antigos dela saem.
            conn.execute("DELETE FROM artifacts WHERE message_id = ?", (message_id,))
            for kind, title, language, content in drafts:
                artifact = Artifact(
                    new_id(),
                    kind,
                    title,
                    language,
                    content,
                    conversation_id,
                    message_id,
                    now,
                    len(content),
                )
                conn.execute(
                    "INSERT INTO artifacts"
                    " (id, user_id, conversation_id, message_id, kind, title, language,"
                    "  content, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        artifact.id,
                        user_id,
                        conversation_id,
                        message_id,
                        kind,
                        title,
                        language,
                        content,
                        now,
                    ),
                )
                saved.append(artifact)
        return saved

    def get_artifact(self, user_id: str, artifact_id: str) -> Artifact | None:
        """Artefato da própria conta, com o conteúdo."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM artifacts WHERE id = ? AND user_id = ?", (artifact_id, user_id)
            ).fetchone()
        return None if row is None else _artifact(row)

    def delete_artifact(self, user_id: str, artifact_id: str) -> bool:
        """Apaga um artefato da própria conta."""
        with self._transaction() as conn:
            changed = conn.execute(
                "DELETE FROM artifacts WHERE id = ? AND user_id = ?", (artifact_id, user_id)
            ).rowcount
        return changed > 0

    def list_library(
        self, user_id: str, *, kind: str, limit: int, before: tuple[int, str] | None = None
    ) -> list[dict[str, Any]]:
        """Biblioteca da conta: o que a pessoa enviou e o que o KAZER produziu.

        As duas origens vêm da mesma ordenação (mais recente primeiro), com
        paginação por `(created_at, id)` para não repetir nem pular item quando
        dois nascem no mesmo segundo.
        """
        rows: list[dict[str, Any]] = []
        # `kind` já chegou validado pelo serviço.
        want_sent = kind in {"tudo", "imagem", "documento"}
        want_made = kind in {"tudo", "artefato"}
        cut = "" if before is None else " AND (created_at, id) < (?, ?)"
        args: list[Any] = [user_id, *([] if before is None else [before[0], before[1]])]

        with self._transaction() as conn:
            if want_sent:
                kinds = {"imagem": ("image",), "documento": ("text", "pdf")}.get(
                    kind, ("image", "text", "pdf")
                )
                marks = ", ".join("?" * len(kinds))
                sent = conn.execute(
                    "SELECT * FROM attachments WHERE user_id = ?"
                    f" AND message_id IS NOT NULL AND kind IN ({marks}){cut}"
                    " ORDER BY created_at DESC, id DESC LIMIT ?",
                    (args[0], *kinds, *args[1:], limit),
                ).fetchall()
                rows += [_library_row(_attachment(row)) for row in sent]
            if want_made:
                made = conn.execute(
                    f"SELECT * FROM artifacts WHERE user_id = ?{cut}"
                    " ORDER BY created_at DESC, id DESC LIMIT ?",
                    (*args, limit),
                ).fetchall()
                rows += [_artifact(row).public(body=False) for row in made]

        rows.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
        return rows[:limit]

    def list_memories(self, user_id: str) -> list[Memory]:
        """Memórias da conta, mais antigas primeiro."""
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM memories WHERE user_id = ? ORDER BY created_at, id", (user_id,)
            ).fetchall()
        return [Memory(row["id"], row["content"], row["created_at"]) for row in rows]

    def add_memory(self, user_id: str, content: str, now: int, max_count: int) -> Memory | None:
        """Adiciona memória; None quando o limite por conta foi atingido."""
        memory = Memory(new_id(), content, now)
        with self._transaction() as conn:
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE user_id = ?", (user_id,)
            ).fetchone()
            if count >= max_count:
                return None
            conn.execute(
                "INSERT INTO memories (id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
                (memory.id, user_id, content, now),
            )
        return memory

    def delete_memory(self, user_id: str, memory_id: str) -> bool:
        """Remove uma memória da própria conta."""
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM memories WHERE id = ? AND user_id = ?", (memory_id, user_id)
            )
        return cursor.rowcount == 1

    def delete_all_memories(self, user_id: str) -> None:
        """Esquece tudo o que a conta salvou."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM memories WHERE user_id = ?", (user_id,))

    # ---------- Exportação ----------

    def export(self, user_id: str) -> dict[str, Any]:
        """Cópia legível de tudo o que a conta guarda no chat (portabilidade, LGPD art. 18)."""
        with self._transaction() as conn:
            conversations = conn.execute(
                "SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at", (user_id,)
            ).fetchall()
            exported = []
            for conversation in conversations:
                rows = conn.execute(
                    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq",
                    (conversation["id"],),
                ).fetchall()
                attachments = self._attachments_for(conn, [row["id"] for row in rows])
                exported.append(
                    {
                        **_conversation(conversation).public(),
                        "messages": [
                            {
                                "role": row["role"],
                                "content": row["content"],
                                "status": row["status"],
                                "created_at": row["created_at"],
                                "attachments": [
                                    {"name": item.name, "media_type": item.media_type,
                                     "size": item.size}
                                    for item in attachments.get(row["id"], [])
                                ],
                            }
                            for row in rows
                        ],
                    }
                )
            memories = conn.execute(
                "SELECT content, created_at FROM memories WHERE user_id = ? ORDER BY created_at",
                (user_id,),
            ).fetchall()
            # Portabilidade é de tudo: os artefatos vão com o conteúdo inteiro.
            made = conn.execute(
                "SELECT * FROM artifacts WHERE user_id = ? ORDER BY created_at", (user_id,)
            ).fetchall()
        return {
            "conversations": exported,
            "memories": [dict(row) for row in memories],
            "artifacts": [_artifact(row).public() for row in made],
            "preferences": self.get_preferences(user_id),
        }
