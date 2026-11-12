"""Rotas de criação: imagens (cota diária, arquivo privado) e o catálogo de capacidades.

Todas autenticadas e, nas escritas, com a verificação de origem do `WebContext`.
A cota e a posse das imagens são decididas no servidor/banco; o navegador só
mostra o que estas rotas respondem. A imagem nasce na conversa (`chat/imagine.py`).
"""

from __future__ import annotations

from typing import Any

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from kazer import capabilities
from kazer.auth.store import User
from kazer.chat.service import ChatError, ChatService
from kazer.chat.uploads import valid_id
from kazer.images.service import ImageService
from kazer.interfaces.web.common import WebContext, endpoint
from kazer.security.rate_limiter import RateLimit, RateLimiter

# Tentativas de gerar imagem por conta (a cota diária é outra coisa, e é do banco).
IMAGE_ATTEMPTS = RateLimit(12, 3600)


def create_routes(
    ctx: WebContext,
    chat: ChatService | None,
    images: ImageService | None,
    limiter: RateLimiter | None = None,
) -> list[Route]:
    limits = limiter or RateLimiter()

    async def account(request: Request) -> User:
        user, _ = await ctx.user(request)
        if chat is None:
            raise ChatError("chat_unavailable" if ctx.auth is not None else "auth_unavailable", 503)
        await run_in_threadpool(chat.ensure_owner, user.id, user.email, user.created_at)
        return user

    def image_service() -> ImageService:
        if images is None:
            raise ChatError("chat_unavailable", 503)
        return images

    def path_id(request: Request, name: str) -> str:
        value = request.path_params[name]
        if not valid_id(value):
            raise ChatError("not_found", 404)
        return value

    # ---------- Capacidades ----------

    @endpoint
    async def catalog(request: Request) -> Response:
        user = await account(request)
        assert chat is not None
        plan = await run_in_threadpool(chat.plan, user.id)
        overrides: dict[str, Any] = {}
        if images is not None and images.available:
            overrides["imagens.criar"] = "available"
        return JSONResponse(
            {"plan": plan.id, "capabilities": capabilities.public_catalog(plan.id, overrides)}
        )

    # ---------- Imagens ----------

    @endpoint
    async def image_list(request: Request) -> Response:
        user = await account(request)
        service = image_service()
        if request.method == "GET":
            return JSONResponse(await run_in_threadpool(service.status, user.id))
        data = await ctx.read_json(request)
        wait = limits.hit(f"image:{user.id}", IMAGE_ATTEMPTS)
        if wait:
            raise ChatError("rate_limited", 429, retry_after=wait)
        job, replayed = await run_in_threadpool(service.create, user.id, data)
        quota = await run_in_threadpool(service.quota, user.id)
        return JSONResponse(
            {"image": job.public(), "replayed": replayed, "quota": quota},
            status_code=200 if replayed else 201,
        )

    @endpoint
    async def image_file(request: Request) -> Response:
        user = await account(request)
        data, media_type = await run_in_threadpool(
            image_service().file, user.id, path_id(request, "image_id")
        )
        return Response(
            data,
            media_type=media_type,
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": 'inline; filename="kazer-imagem"',
            },
        )

    @endpoint
    async def image_item(request: Request) -> Response:
        user = await account(request)
        ctx.check_origin(request)
        await run_in_threadpool(image_service().delete, user.id, path_id(request, "image_id"))
        return JSONResponse({"status": "deleted"})

    return [
        Route("/api/capabilities", catalog, methods=["GET"]),
        Route("/api/images", image_list, methods=["GET", "POST"]),
        Route("/api/images/{image_id}/file", image_file, methods=["GET"]),
        Route("/api/images/{image_id}", image_item, methods=["DELETE"]),
    ]
