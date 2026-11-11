"""Imagens, Studio e memória com procedência no Postgres do Supabase.

Mixin do `SupabaseChatStore`: cada método chama uma função `kazer_*` da migração
`20261110120000_kazer_images_studio_memory.sql` com o JWT da própria pessoa.
Sem a migração aplicada, o PostgREST responde 404 e `_rpc` levanta
`StorageUnavailable(not_migrated=True)` — a tela avisa em vez de fingir.
"""

from __future__ import annotations

from typing import Any

from kazer.chat.store_extras import Design, ImageJob, Reservation, design, image_job


class SupabaseExtras:
    """Usa `self._rpc()` da classe principal."""

    def _rpc(self, name: str, params: dict[str, Any] | None = None) -> Any:  # pragma: no cover
        raise NotImplementedError

    # ---------- Imagens ----------

    def image_usage(self, user_id: str, day: str, now: int, stale_after: int) -> tuple[int, int]:
        data = self._rpc("kazer_image_usage_today", {"p_stale_seconds": stale_after}) or {}
        return int(data.get("succeeded") or 0), int(data.get("active") or 0)

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
        # O dia e a hora são os do banco (UTC): relógio do servidor web não decide cota.
        data = self._rpc(
            "kazer_image_reserve",
            {
                "p_key": key,
                "p_prompt": prompt,
                "p_width": width,
                "p_height": height,
                "p_limit": limit,
                "p_stale_seconds": stale_after,
            },
        )
        if not isinstance(data, dict):
            return Reservation(None, reason="quota")
        job = data.get("job")
        return Reservation(
            image_job(job) if isinstance(job, dict) else None,
            replayed=bool(data.get("replayed")),
            reason=str(data.get("reason") or ""),
        )

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
        data = self._rpc(
            "kazer_image_finish",
            {
                "p_id": job_id,
                "p_ok": ok,
                "p_provider": provider,
                "p_error": error_code,
                "p_media_type": media_type,
                "p_size": size,
            },
        )
        return image_job(data) if isinstance(data, dict) else None

    def list_images(self, user_id: str, limit: int = 30) -> list[ImageJob]:
        rows = self._rpc("kazer_images", {"p_limit": limit}) or []
        return [image_job(row) for row in rows]

    def get_image(self, user_id: str, job_id: str) -> ImageJob | None:
        data = self._rpc("kazer_image", {"p_id": job_id})
        return image_job(data) if isinstance(data, dict) else None

    def delete_image(self, user_id: str, job_id: str) -> bool:
        return bool(self._rpc("kazer_delete_image", {"p_id": job_id}))

    # ---------- Studio ----------

    def list_designs(self, user_id: str, limit: int = 60) -> list[Design]:
        rows = self._rpc("kazer_designs", {"p_limit": limit}) or []
        return [design(row, body=False) for row in rows]

    def get_design(self, user_id: str, design_id: str) -> Design | None:
        data = self._rpc("kazer_design", {"p_id": design_id})
        return design(data) if isinstance(data, dict) else None

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
        saved = self._rpc(
            "kazer_save_design",
            {
                "p_id": design_id,
                "p_title": title,
                "p_width": width,
                "p_height": height,
                "p_data": data,
                "p_thumb": thumb,
                "p_max": max_count,
            },
        )
        return design(saved) if isinstance(saved, dict) else None

    def delete_design(self, user_id: str, design_id: str) -> bool:
        return bool(self._rpc("kazer_delete_design", {"p_id": design_id}))
