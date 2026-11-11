"""Tabelas e operações novas do SQLite: imagens geradas, projetos do Studio e
os campos extras da memória. Fica separado do `store.py` para o arquivo
principal não crescer; `ChatStore` herda este mixin.

A cota de imagens é atômica: cada operação roda dentro de `BEGIN IMMEDIATE`
(uma escrita por vez no banco), então duas requisições simultâneas nunca
reservam a mesma vaga.
"""

from __future__ import annotations

import secrets
import sqlite3
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any

EXTRAS_SCHEMA = """
CREATE TABLE IF NOT EXISTS image_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    day TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
    prompt TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    error_code TEXT,
    media_type TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS image_jobs_user_day ON image_jobs(user_id, day, status);
CREATE INDEX IF NOT EXISTS image_jobs_user_created ON image_jobs(user_id, created_at);
CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    data TEXT NOT NULL,
    thumb TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS designs_user ON designs(user_id, updated_at);
"""

_MEMORY_COLUMNS = (
    ("source", "TEXT NOT NULL DEFAULT 'manual'"),
    ("conversation_id", "TEXT"),
    ("confidence", "REAL NOT NULL DEFAULT 1.0"),
    ("updated_at", "INTEGER"),
)


def _new_id() -> str:
    return secrets.token_urlsafe(12)


@dataclass(frozen=True, slots=True)
class ImageJob:
    """Um pedido de imagem: reservado, concluído ou falho."""

    id: str
    user_id: str
    idempotency_key: str
    day: str
    status: str
    prompt: str
    width: int
    height: int
    provider: str
    error_code: str | None
    media_type: str | None
    size: int
    created_at: int
    finished_at: int | None

    def public(self) -> dict[str, Any]:
        """Formato enviado ao navegador (nunca inclui o dono nem a chave)."""
        done = self.status == "succeeded"
        return {
            "id": self.id,
            "status": self.status,
            "prompt": self.prompt,
            "width": self.width,
            "height": self.height,
            "provider": self.provider,
            "error": self.error_code,
            "media_type": self.media_type,
            "size": self.size,
            "created_at": self.created_at,
            "url": f"/api/images/{self.id}/file" if done else None,
        }


@dataclass(frozen=True, slots=True)
class Reservation:
    """Resultado de pedir uma vaga: `reason` é "", "quota" ou "busy"."""

    job: ImageJob | None
    replayed: bool = False
    reason: str = ""


@dataclass(frozen=True, slots=True)
class Design:
    """Projeto editável do Studio."""

    id: str
    title: str
    width: int
    height: int
    data: str
    thumb: str
    created_at: int
    updated_at: int

    def public(self, *, body: bool = True) -> dict[str, Any]:
        item: dict[str, Any] = {
            "id": self.id,
            "title": self.title,
            "width": self.width,
            "height": self.height,
            "thumb": self.thumb,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if body:
            item["data"] = self.data
        return item


def image_job(row: Any) -> ImageJob:
    return ImageJob(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        idempotency_key=row["idempotency_key"],
        day=str(row["day"]),
        status=row["status"],
        prompt=row["prompt"],
        width=int(row["width"]),
        height=int(row["height"]),
        provider=row["provider"] or "",
        error_code=row["error_code"],
        media_type=row["media_type"],
        size=int(row["size"] or 0),
        created_at=int(row["created_at"]),
        finished_at=None if row["finished_at"] is None else int(row["finished_at"]),
    )


def design(row: Any, *, body: bool = True) -> Design:
    return Design(
        id=str(row["id"]),
        title=row["title"],
        width=int(row["width"]),
        height=int(row["height"]),
        data=(row["data"] or "") if body else "",
        thumb=row["thumb"] or "",
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
    )


class SqliteExtras:
    """Mixin do `ChatStore`: usa `self._transaction()` da classe principal."""

    def _transaction(self) -> AbstractContextManager[sqlite3.Connection]:  # pragma: no cover
        raise NotImplementedError

    @staticmethod
    def init_extras(conn: sqlite3.Connection) -> None:
        """Cria as tabelas novas e acrescenta colunas à memória (bancos antigos)."""
        conn.executescript(EXTRAS_SCHEMA)
        have = {row[1] for row in conn.execute("PRAGMA table_info(memories)")}
        for name, spec in _MEMORY_COLUMNS:
            if name not in have:
                conn.execute(f"ALTER TABLE memories ADD COLUMN {name} {spec}")

    # ---------- Imagens ----------

    @staticmethod
    def _expire_stale(conn: sqlite3.Connection, user_id: str, now: int, stale_after: int) -> None:
        conn.execute(
            "UPDATE image_jobs SET status = 'failed', error_code = 'image_stale',"
            " finished_at = ?, updated_at = ? WHERE user_id = ? AND status = 'reserved'"
            " AND updated_at < ?",
            (now, now, user_id, now - stale_after),
        )

    @staticmethod
    def _image_counts(conn: sqlite3.Connection, user_id: str, day: str) -> tuple[int, int]:
        done, active = conn.execute(
            "SELECT COALESCE(SUM(status = 'succeeded'), 0), COALESCE(SUM(status = 'reserved'), 0)"
            " FROM image_jobs WHERE user_id = ? AND day = ?",
            (user_id, day),
        ).fetchone()
        return int(done), int(active)

    def image_usage(self, user_id: str, day: str, now: int, stale_after: int) -> tuple[int, int]:
        """(imagens concluídas hoje, pedidos em andamento)."""
        with self._transaction() as conn:
            self._expire_stale(conn, user_id, now, stale_after)
            return self._image_counts(conn, user_id, day)

    def image_reserve(
        self,
        user_id: str,
        key: str,
        prompt: str,
        width: int,
        height: int,
        day: str,
        limit: int,
        now: int,
        stale_after: int,
    ) -> Reservation:
        """Reserva uma vaga do dia. Mesma chave = mesmo pedido (nunca duplica)."""
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM image_jobs WHERE user_id = ? AND idempotency_key = ?",
                (user_id, key),
            ).fetchone()
            if row is not None:
                return Reservation(image_job(row), replayed=True)
            self._expire_stale(conn, user_id, now, stale_after)
            done, active = self._image_counts(conn, user_id, day)
            if done >= limit:
                return Reservation(None, reason="quota")
            if done + active >= limit:
                return Reservation(None, reason="busy")
            job_id = _new_id()
            conn.execute(
                "INSERT INTO image_jobs (id, user_id, idempotency_key, day, status, prompt,"
                " width, height, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)",
                (job_id, user_id, key, day, prompt, width, height, now, now),
            )
            row = conn.execute("SELECT * FROM image_jobs WHERE id = ?", (job_id,)).fetchone()
            return Reservation(image_job(row))

    def image_finish(
        self,
        user_id: str,
        job_id: str,
        ok: bool,
        now: int,
        *,
        provider: str = "",
        error_code: str | None = None,
        media_type: str | None = None,
        size: int = 0,
    ) -> ImageJob | None:
        """Conclui um pedido reservado exatamente uma vez; None se já foi concluído."""
        with self._transaction() as conn:
            changed = conn.execute(
                "UPDATE image_jobs SET status = ?, provider = ?, error_code = ?, media_type = ?,"
                " size = ?, finished_at = ?, updated_at = ?"
                " WHERE id = ? AND user_id = ? AND status = 'reserved'",
                (
                    "succeeded" if ok else "failed",
                    provider,
                    None if ok else (error_code or "image_failed"),
                    media_type if ok else None,
                    size if ok else 0,
                    now,
                    now,
                    job_id,
                    user_id,
                ),
            ).rowcount
            if changed != 1:
                return None
            row = conn.execute("SELECT * FROM image_jobs WHERE id = ?", (job_id,)).fetchone()
            return image_job(row)

    def list_images(self, user_id: str, limit: int = 30) -> list[ImageJob]:
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM image_jobs WHERE user_id = ? AND status = 'succeeded'"
                " AND media_type IS NOT NULL ORDER BY created_at DESC, id LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [image_job(row) for row in rows]

    def get_image(self, user_id: str, job_id: str) -> ImageJob | None:
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM image_jobs WHERE id = ? AND user_id = ?", (job_id, user_id)
            ).fetchone()
        return None if row is None else image_job(row)

    def delete_image(self, user_id: str, job_id: str) -> bool:
        """Tira a imagem da galeria. O dia já usado continua contado."""
        with self._transaction() as conn:
            changed = conn.execute(
                "UPDATE image_jobs SET prompt = '', media_type = NULL, size = 0,"
                " error_code = 'deleted', updated_at = updated_at"
                " WHERE id = ? AND user_id = ? AND status = 'succeeded' AND media_type IS NOT NULL",
                (job_id, user_id),
            ).rowcount
        return changed == 1

    # ---------- Studio ----------

    def list_designs(self, user_id: str, limit: int = 60) -> list[Design]:
        with self._transaction() as conn:
            rows = conn.execute(
                "SELECT id, title, width, height, '' AS data, thumb, created_at, updated_at"
                " FROM designs WHERE user_id = ? ORDER BY updated_at DESC, id LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [design(row, body=False) for row in rows]

    def get_design(self, user_id: str, design_id: str) -> Design | None:
        with self._transaction() as conn:
            row = conn.execute(
                "SELECT * FROM designs WHERE id = ? AND user_id = ?", (design_id, user_id)
            ).fetchone()
        return None if row is None else design(row)

    def save_design(
        self,
        user_id: str,
        design_id: str | None,
        title: str,
        width: int,
        height: int,
        data: str,
        thumb: str,
        now: int,
        max_count: int,
    ) -> Design | None:
        """Cria (sem id) ou atualiza. None: limite de projetos ou projeto de outra conta."""
        with self._transaction() as conn:
            if design_id is None:
                (count,) = conn.execute(
                    "SELECT COUNT(*) FROM designs WHERE user_id = ?", (user_id,)
                ).fetchone()
                if count >= max_count:
                    return None
                design_id = _new_id()
                conn.execute(
                    "INSERT INTO designs (id, user_id, title, width, height, data, thumb,"
                    " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (design_id, user_id, title, width, height, data, thumb, now, now),
                )
            else:
                changed = conn.execute(
                    "UPDATE designs SET title = ?, width = ?, height = ?, data = ?, thumb = ?,"
                    " updated_at = ? WHERE id = ? AND user_id = ?",
                    (title, width, height, data, thumb, now, design_id, user_id),
                ).rowcount
                if changed != 1:
                    return None
            row = conn.execute("SELECT * FROM designs WHERE id = ?", (design_id,)).fetchone()
            return design(row)

    def delete_design(self, user_id: str, design_id: str) -> bool:
        with self._transaction() as conn:
            changed = conn.execute(
                "DELETE FROM designs WHERE id = ? AND user_id = ?", (design_id, user_id)
            ).rowcount
        return changed == 1

    def count_designs(self, user_id: str) -> int:
        with self._transaction() as conn:
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM designs WHERE user_id = ?", (user_id,)
            ).fetchone()
        return int(count)
