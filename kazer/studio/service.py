"""Regras dos projetos do Studio: validação do documento, limites e posse.

O documento é JSON versionado, montado pelo editor (`static/assets/studio.js`):

    {"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": {...}}

O servidor não interpreta o desenho; ele garante tamanho, formato e que cada
conta só enxerga os próprios projetos.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from typing import Any, Protocol

from kazer.chat.service import ChatError
from kazer.chat.store_extras import Design

MAX_DESIGN_BYTES = 3 * 1024 * 1024
MAX_THUMB_CHARS = 60_000
MAX_TITLE = 80
MIN_SIDE, MAX_SIDE = 64, 4096
DOCUMENT_VERSION = 1
_THUMB = re.compile(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]")


class DesignStore(Protocol):
    def list_designs(self, user_id: str, limit: int = 60) -> list[Design]: ...

    def get_design(self, user_id: str, design_id: str) -> Design | None: ...

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
    ) -> Design | None: ...

    def delete_design(self, user_id: str, design_id: str) -> bool: ...


class StudioService:
    def __init__(
        self,
        store: DesignStore,
        *,
        limit_of: Callable[[str], int],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._limit_of = limit_of
        self._clock = clock

    def list(self, user_id: str) -> dict[str, Any]:
        items = self._store.list_designs(user_id)
        return {
            "designs": [item.public(body=False) for item in items],
            "limit": self._limit_of(user_id),
        }

    def get(self, user_id: str, design_id: str) -> Design:
        found = self._store.get_design(user_id, design_id)
        if found is None:
            raise ChatError("not_found", 404)
        return found

    @staticmethod
    def _validate(data: dict[str, Any]) -> tuple[str, int, int, str, str]:
        title = data.get("title", "")
        document = data.get("data")
        thumb = data.get("thumb", "")
        if (
            not isinstance(title, str)
            or not isinstance(document, str)
            or not isinstance(thumb, str)
        ):
            raise ChatError("invalid_request", 400)
        title = " ".join(_CONTROL.sub("", title).split())[:MAX_TITLE] or "Sem título"
        if len(document.encode("utf-8")) > MAX_DESIGN_BYTES:
            raise ChatError("design_too_large", 413)
        try:
            parsed = json.loads(document)
        except ValueError:
            raise ChatError("invalid_request", 400) from None
        if not isinstance(parsed, dict) or parsed.get("v") != DOCUMENT_VERSION:
            raise ChatError("invalid_request", 400)
        width, height = parsed.get("w"), parsed.get("h")
        if not all(
            isinstance(side, int) and MIN_SIDE <= side <= MAX_SIDE for side in (width, height)
        ):
            raise ChatError("invalid_request", 400)
        if not isinstance(parsed.get("canvas"), dict):
            raise ChatError("invalid_request", 400)
        if thumb and (len(thumb) > MAX_THUMB_CHARS or not _THUMB.match(thumb)):
            thumb = ""
        return title, int(width), int(height), document, thumb

    def save(self, user_id: str, design_id: str | None, data: dict[str, Any]) -> Design:
        title, width, height, document, thumb = self._validate(data)
        saved = self._store.save_design(
            user_id,
            design_id,
            title,
            width,
            height,
            document,
            thumb,
            int(self._clock()),
            self._limit_of(user_id),
        )
        if saved is None:
            # Atualização: não existe (ou é de outra conta). Criação: limite do plano.
            raise ChatError("not_found", 404) if design_id else ChatError("design_limit", 409)
        return saved

    def delete(self, user_id: str, design_id: str) -> None:
        if not self._store.delete_design(user_id, design_id):
            raise ChatError("not_found", 404)
