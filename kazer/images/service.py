"""Regras da criação de imagens: validação, cota diária e ciclo do pedido.

Ciclo: **reservar → gerar → concluir**.

1. `reserve` (no banco, atômico) guarda a vaga do dia para este pedido.
2. O provedor gera a imagem (pode falhar, demorar ou estourar o prazo).
3. `finish` conclui o pedido uma única vez: sucesso conta no dia; falha libera a vaga.

O dia é o dia **UTC**. Reserva que ninguém concluiu (função que morreu no meio)
expira sozinha em `STALE_AFTER` segundos, e a vaga volta.
"""

from __future__ import annotations

import hashlib
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from kazer.chat.service import ChatError
from kazer.chat.store_extras import ImageJob, Reservation
from kazer.images.providers import ImageError, ImageProvider

STALE_AFTER = 600
PROMPT_MIN = 3
PROMPT_MAX = 800
ASPECTS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "4:5": (1024, 1280),
    "9:16": (864, 1536),
    "16:9": (1536, 864),
}
# Estilo é só um complemento fixo do pedido; nada de modelo reescrevendo o texto.
STYLES: dict[str, str] = {
    "": "",
    "foto": "fotografia realista, luz natural, alta nitidez",
    "ilustracao": "ilustração digital, traço limpo, cores harmônicas",
    "3d": "render 3D, materiais realistas, iluminação de estúdio",
    "pixel": "pixel art, paleta limitada, contornos nítidos",
    "minimal": "design minimalista, formas simples, muito espaço vazio",
}
_KEY = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")


class ImageStore(Protocol):
    def image_usage(
        self, user_id: str, day: str, now: int, stale_after: int
    ) -> tuple[int, int]: ...

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
    ) -> Reservation: ...

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
    ) -> ImageJob | None: ...

    def list_images(self, user_id: str, limit: int = 30) -> list[ImageJob]: ...

    def get_image(self, user_id: str, job_id: str) -> ImageJob | None: ...

    def delete_image(self, user_id: str, job_id: str) -> bool: ...


class Files(Protocol):
    def save(self, user_id: str, attachment_id: str, data: bytes) -> None: ...

    def read(self, user_id: str, attachment_id: str) -> bytes | None: ...

    def delete(self, user_id: str, attachment_id: str) -> None: ...


def utc_day(now: float) -> str:
    return datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%d")


def next_reset(now: float) -> int:
    """Instante (epoch) da próxima meia-noite UTC: quando a cota volta."""
    today = datetime.fromtimestamp(now, UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((today + timedelta(days=1)).timestamp())


def file_id(job_id: str) -> str:
    """Nome do arquivo no armazenamento privado (mesmo formato dos anexos)."""
    return job_id


class ImageService:
    """Uma instância por aplicação; sem estado próprio além das dependências."""

    def __init__(
        self,
        store: ImageStore,
        files: Files,
        provider: ImageProvider | None,
        *,
        limit_of: Callable[[str], int],
        clock: Callable[[], float] = time.time,
        stale_after: int = STALE_AFTER,
    ) -> None:
        self._store = store
        self._files = files
        self._provider = provider
        self._limit_of = limit_of
        self._clock = clock
        self._stale_after = stale_after

    @property
    def available(self) -> bool:
        """Há um provedor ligado neste ambiente."""
        return self._provider is not None

    # ---------- Leitura ----------

    def quota(self, user_id: str) -> dict[str, Any]:
        """Quanto resta hoje, direto do banco (o navegador nunca conta sozinho)."""
        now = self._clock()
        limit = max(0, self._limit_of(user_id))
        done, active = self._store.image_usage(user_id, utc_day(now), int(now), self._stale_after)
        return {
            "limit": limit,
            "used": done,
            "in_progress": active,
            "remaining": max(0, limit - done - active),
            "resets_at": next_reset(now),
        }

    def status(self, user_id: str) -> dict[str, Any]:
        provider = self._provider
        return {
            "available": provider is not None,
            "provider": None
            if provider is None
            else {"id": provider.name, "label": provider.label},
            "aspects": list(ASPECTS),
            "styles": [key for key in STYLES if key],
            "prompt_max": PROMPT_MAX,
            "quota": self.quota(user_id),
            "images": [job.public() for job in self._store.list_images(user_id)],
        }

    # ---------- Criação ----------

    @staticmethod
    def _prompt(raw: Any) -> str:
        if not isinstance(raw, str):
            raise ChatError("invalid_request", 400)
        text = " ".join(_CONTROL.sub("", raw).split())
        if len(text) < PROMPT_MIN:
            raise ChatError("image_prompt_short", 400)
        if len(text) > PROMPT_MAX:
            raise ChatError("image_prompt_long", 400)
        return text

    def create(self, user_id: str, data: dict[str, Any]) -> tuple[ImageJob, bool]:
        """Gera uma imagem. Devolve (pedido concluído, se foi repetição da mesma chave)."""
        provider = self._provider
        if provider is None:
            raise ChatError("image_unavailable", 503)
        prompt = self._prompt(data.get("prompt"))
        aspect = data.get("aspect", "1:1")
        style = data.get("style", "")
        key = data.get("idempotency_key")
        if aspect not in ASPECTS or style not in STYLES:
            raise ChatError("invalid_request", 400)
        if not isinstance(key, str) or not _KEY.match(key):
            raise ChatError("invalid_request", 400)
        width, height = ASPECTS[aspect]
        now = self._clock()
        limit = max(0, self._limit_of(user_id))

        reservation = self._store.image_reserve(
            user_id, key, prompt, width, height, utc_day(now), limit, int(now), self._stale_after
        )
        job = reservation.job
        if job is None:
            if reservation.reason == "busy":
                raise ChatError("image_in_progress", 409, retry_after=5)
            raise ChatError("image_quota", 429, resets_at=next_reset(now), limit=limit)
        if reservation.replayed:
            if job.status == "succeeded":
                return job, True
            if job.status == "reserved":
                raise ChatError("image_in_progress", 409, retry_after=5)
            raise ChatError(job.error_code or "image_failed", 502)

        full_prompt = f"{prompt}. {STYLES[style]}" if STYLES[style] else prompt
        seed = int.from_bytes(hashlib.sha256(job.id.encode()).digest()[:4], "big")
        try:
            generated = provider.generate(full_prompt, width, height, seed)
            self._files.save(user_id, file_id(job.id), generated.data)
        except ImageError as exc:
            self._fail(user_id, job.id, exc.code, provider.name)
            raise ChatError(exc.code, 503 if exc.code == "image_busy" else 502) from None
        except Exception:
            # Qualquer falha libera a vaga: erro nosso não pode custar a imagem do dia.
            self._fail(user_id, job.id, "image_failed", provider.name)
            raise
        done = self._store.image_finish(
            user_id,
            job.id,
            True,
            int(self._clock()),
            provider=provider.name,
            media_type=generated.media_type,
            size=len(generated.data),
        )
        if done is None:
            # A reserva expirou enquanto gerava (ou foi concluída por outra via).
            self._files.delete(user_id, file_id(job.id))
            raise ChatError("image_timeout", 504)
        return done, False

    def _fail(self, user_id: str, job_id: str, code: str, provider: str) -> None:
        self._store.image_finish(
            user_id, job_id, False, int(self._clock()), provider=provider, error_code=code
        )

    # ---------- Arquivo ----------

    def file(self, user_id: str, job_id: str) -> tuple[bytes, str]:
        """Bytes da imagem, só para a conta dona."""
        job = self._store.get_image(user_id, job_id)
        if job is None or job.status != "succeeded" or not job.media_type:
            raise ChatError("not_found", 404)
        data = self._files.read(user_id, file_id(job.id))
        if data is None:
            raise ChatError("not_found", 404)
        return data, job.media_type

    def delete(self, user_id: str, job_id: str) -> None:
        if not self._store.delete_image(user_id, job_id):
            raise ChatError("not_found", 404)
        self._files.delete(user_id, file_id(job_id))
