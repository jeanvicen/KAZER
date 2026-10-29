"""Persistência mínima de contas em SQLite (biblioteca padrão).

Dados guardados por conta: e-mail, hash Argon2id da senha, data de criação e de
confirmação do e-mail. Sessões e links de e-mail guardam apenas o hash do token.
Excluir a linha de `users` remove em cascata sessões e tokens.
"""

import os
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    email_verified_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, purpose);
"""


class TokenPurpose(StrEnum):
    """Finalidade única de cada link enviado por e-mail."""

    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"


@dataclass(frozen=True, slots=True)
class User:
    """Conta local; o hash nunca sai da camada de serviço."""

    id: str
    email: str
    password_hash: str
    created_at: int
    email_verified_at: int | None

    @property
    def verified(self) -> bool:
        """Indica se o e-mail foi confirmado."""
        return self.email_verified_at is not None


def _user(row: sqlite3.Row | None) -> User | None:
    if row is None:
        return None
    return User(
        id=row["id"],
        email=row["email"],
        password_hash=row["password_hash"],
        created_at=row["created_at"],
        email_verified_at=row["email_verified_at"],
    )


class AuthStore:
    """Repositório síncrono; cada operação abre uma conexão curta e transacional."""

    def __init__(self, path: Path) -> None:
        """Não toca o disco até `initialize()`."""
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

    def initialize(self) -> None:
        """Cria diretório e esquema; restringe o arquivo ao usuário do processo."""
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        conn = sqlite3.connect(self._path, isolation_level=None)
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(_SCHEMA)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        finally:
            conn.close()
        os.chmod(self._path, 0o600)

    def create_user(self, email: str, password_hash: str, now: int) -> User | None:
        """Cria conta não confirmada; retorna None se o e-mail já existir."""
        user = User(uuid.uuid4().hex, email, password_hash, now, None)
        try:
            with self._transaction() as conn:
                conn.execute(
                    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (user.id, user.email, user.password_hash, user.created_at),
                )
        except sqlite3.IntegrityError:
            return None
        return user

    def find_user_by_email(self, email: str) -> User | None:
        """Busca por e-mail já normalizado."""
        with self._transaction() as conn:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return _user(row)

    def update_password_hash(self, user_id: str, password_hash: str) -> None:
        """Atualiza o hash (rehash transparente após mudança de parâmetros)."""
        with self._transaction() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id)
            )

    def delete_user(self, user_id: str) -> None:
        """Remove a conta e, em cascata, todas as sessões e tokens."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def create_session(self, user_id: str, token_hash: str, now: int, expires_at: int) -> None:
        """Registra sessão nova; o token em claro existe apenas no cookie do navegador."""
        with self._transaction() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)"
                " VALUES (?, ?, ?, ?)",
                (token_hash, user_id, now, expires_at),
            )

    def find_session_user(self, token_hash: str, now: int) -> User | None:
        """Resolve sessão válida e não expirada."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id"
                " WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (token_hash, now),
            ).fetchone()
        return _user(row)

    def delete_session(self, token_hash: str) -> None:
        """Encerra uma sessão específica."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def create_email_token(
        self, user_id: str, token_hash: str, purpose: TokenPurpose, now: int, expires_at: int
    ) -> None:
        """Mantém apenas um link ativo por finalidade; os anteriores deixam de valer."""
        with self._transaction() as conn:
            conn.execute(
                "DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?",
                (user_id, purpose.value),
            )
            conn.execute(
                "INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (token_hash, user_id, purpose.value, now, expires_at),
            )

    def find_email_token_user(
        self, token_hash: str, purpose: TokenPurpose, now: int
    ) -> User | None:
        """Consulta sem consumir, para validar a nova senha antes de gastar o link."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT users.* FROM email_tokens JOIN users ON users.id = email_tokens.user_id"
                " WHERE email_tokens.token_hash = ? AND email_tokens.purpose = ?"
                " AND email_tokens.expires_at > ?",
                (token_hash, purpose.value, now),
            ).fetchone()
        return _user(row)

    def _consume(
        self, conn: sqlite3.Connection, token_hash: str, purpose: TokenPurpose, now: int
    ) -> str | None:
        row = conn.execute(
            "SELECT user_id FROM email_tokens WHERE token_hash = ? AND purpose = ?"
            " AND expires_at > ?",
            (token_hash, purpose.value, now),
        ).fetchone()
        if row is None:
            return None
        user_id: str = row["user_id"]
        conn.execute(
            "DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?", (user_id, purpose.value)
        )
        return user_id

    def verify_email_with_token(self, token_hash: str, now: int) -> bool:
        """Consome o link de confirmação de forma atômica e de uso único."""
        with self._transaction() as conn:
            user_id = self._consume(conn, token_hash, TokenPurpose.VERIFY_EMAIL, now)
            if user_id is None:
                return False
            conn.execute(
                "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?",
                (now, user_id),
            )
        return True

    def reset_password_with_token(self, token_hash: str, password_hash: str, now: int) -> bool:
        """Troca a senha, confirma o e-mail e encerra todas as sessões da conta."""
        with self._transaction() as conn:
            user_id = self._consume(conn, token_hash, TokenPurpose.RESET_PASSWORD, now)
            if user_id is None:
                return False
            conn.execute(
                "UPDATE users SET password_hash = ?,"
                " email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?",
                (password_hash, now, user_id),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return True

    def purge_expired(self, now: int, unverified_ttl: int) -> None:
        """Retenção: apaga sessões/links vencidos e contas nunca confirmadas."""
        with self._transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            conn.execute("DELETE FROM email_tokens WHERE expires_at <= ?", (now,))
            conn.execute(
                "DELETE FROM users WHERE email_verified_at IS NULL AND created_at <= ?",
                (now - unverified_ttl,),
            )
