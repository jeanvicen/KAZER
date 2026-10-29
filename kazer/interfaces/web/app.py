"""Aplicação ASGI: tela de entrada, chat autenticado e as APIs `/api/*`.

Defesas na borda: CSP sem origens externas, verificação de `Origin` contra CSRF,
corpo limitado por rota, cookie de sessão HttpOnly/SameSite e cabeçalhos que
desligam cache, referer e APIs sensíveis do navegador.
"""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import MutableHeaders
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from kazer.auth.service import AuthError, AuthService
from kazer.auth.store import AuthStore
from kazer.auth.supabase_service import SupabaseAuthService
from kazer.brain.model_provider import ModelProvider, build_provider
from kazer.chat.service import ChatService
from kazer.chat.store import ChatStore
from kazer.chat.uploads import UploadStorage
from kazer.config.settings import Settings, load_settings
from kazer.integrations.email import build_mail_sender
from kazer.interfaces.web.chat_api import chat_routes
from kazer.interfaces.web.common import TOKEN_MAX_LENGTH, WebContext, client_of, endpoint
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter
from kazer.security.secrets import get_secret

logger = logging.getLogger("kazer.web")

STATIC_DIR = Path(__file__).parent / "static"

_CSP = "; ".join(
    (
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        # blob: só para a prévia local de anexos escolhidos antes do envio.
        "img-src 'self' blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    )
)


class SecurityHeaders:
    """Middleware ASGI puro que aplica cabeçalhos de proteção a toda resposta."""

    def __init__(self, app: ASGIApp, hsts: bool) -> None:
        """`hsts` só faz sentido quando o site é servido por HTTPS."""
        self.app = app
        self.headers = {
            "Content-Security-Policy": _CSP,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Permissions-Policy": (
                "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
            ),
        }
        if hsts:
            self.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Injeta os cabeçalhos no início de cada resposta HTTP."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_api = scope["path"].startswith("/api/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers.items():
                    headers[name] = value
                if is_api:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _build_service(settings: Settings) -> AuthService | SupabaseAuthService | None:
    """Cria o serviço real ou None quando a configuração não permite operar com segurança."""
    if settings.supabase_configured:
        return SupabaseAuthService(
            settings.supabase_url,
            settings.supabase_publishable_key,
            settings.supabase_auth_redirect_url or settings.public_origin,
            RateLimiter(),
            service_role_key=_service_role_key(),
        )
    blockers = settings.auth_blockers
    if not blockers:
        try:
            mailer = build_mail_sender(settings)
        except (LookupError, PermissionError):
            blockers = ["senha SMTP não configurada"]
        else:
            return AuthService(
                AuthStore(settings.database_path),
                PasswordHashing(),
                mailer,
                RateLimiter(),
                settings.public_origin,
            )
    # Só motivos de configuração, nunca valores; a tela segue no ar com contas fechadas.
    logger.warning("auth.unavailable: %s", "; ".join(blockers))
    return None


def _service_role_key() -> str | None:
    try:
        return get_secret("SUPABASE_SERVICE_ROLE_KEY", scope="supabase_admin")
    except LookupError:
        return None


def _build_chat(settings: Settings, provider: ModelProvider | None) -> ChatService:
    return ChatService(
        ChatStore(settings.database_path),
        UploadStorage(settings.upload_dir),
        provider,
        hourly_units=settings.chat_hourly_units,
        daily_units=settings.chat_daily_units,
    )


def create_app(
    settings: Settings | None = None,
    service: AuthService | SupabaseAuthService | None = None,
    *,
    provider: ModelProvider | None = None,
    chat: ChatService | None = None,
) -> Starlette:
    """Monta a aplicação com dependências reais ou injetadas (testes)."""
    settings = settings or load_settings()
    auth = service if service is not None else _build_service(settings)
    cookie_name = "__Host-kazer_session" if settings.cookie_secure else "kazer_session"
    ctx = WebContext(
        auth=auth,
        cookie_name=cookie_name,
        public_origin=settings.public_origin,
        secure=settings.cookie_secure,
    )
    # O chat depende de contas e de disco persistente (SQLite). Em funções serverless
    # (mesmo com o Supabase Auth ligado) ele fica fechado até existir um banco do chat.
    if chat is None and auth is not None and not settings.serverless:
        chat = _build_chat(settings, provider if provider is not None else build_provider(settings))

    def page(name: str, media_type: str = "text/html") -> Callable[[Request], Awaitable[Response]]:
        async def serve(request: Request) -> Response:
            return FileResponse(
                STATIC_DIR / name, media_type=media_type, headers={"Cache-Control": "no-cache"}
            )

        return serve

    async def service_worker(request: Request) -> Response:
        # Escopo na raiz para a tela offline funcionar em qualquer rota do app.
        return FileResponse(
            STATIC_DIR / "sw.js",
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
        )

    async def health(request: Request) -> Response:
        # Sonda de conectividade do navegador: barata, sem banco e sem dados.
        return JSONResponse({"ok": True, "time": int(time.time())})

    @endpoint
    async def session(request: Request) -> Response:
        if auth is None:
            return JSONResponse({"authenticated": False, "available": False})
        token = request.cookies.get(cookie_name)
        user, grant = await run_in_threadpool(auth.resolve_session, token)
        if user is None:
            response = JSONResponse({"authenticated": False})
            if token:
                ctx.clear_session_cookie(response)
            return response
        response = JSONResponse({"authenticated": True, "email": user.email})
        if grant is not None:
            ctx.set_session_cookie(response, grant.token, grant.max_age)
        return response

    @endpoint
    async def register(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        email, password = ctx.field(data, "email"), ctx.field(data, "password")
        await run_in_threadpool(auth.register, email, password, client_of(request))
        return JSONResponse({"status": "verification_sent"}, status_code=202)

    @endpoint
    async def resend_verification(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        message = await run_in_threadpool(
            auth.resend_verification, ctx.field(data, "email"), client_of(request)
        )
        task = BackgroundTask(auth.deliver, message) if message else None
        return JSONResponse({"status": "accepted"}, status_code=202, background=task)

    @endpoint
    async def verify_email(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        token = ctx.field(data, "token", TOKEN_MAX_LENGTH)
        refresh = data.get("refresh_token")
        if isinstance(auth, SupabaseAuthService):
            if refresh is not None and (not isinstance(refresh, str) or len(refresh) > 512):
                raise AuthError("invalid_request", 400)
            grant = await run_in_threadpool(auth.verify_email, token, client_of(request), refresh)
        else:
            grant = await run_in_threadpool(auth.verify_email, token, client_of(request))
        if grant is None:
            return JSONResponse({"status": "verified"})
        # Confirmou pelo link: entra direto no chat, sem passar de novo pelo login.
        await run_in_threadpool(auth.logout, request.cookies.get(cookie_name))
        response = JSONResponse({"status": "verified", "authenticated": True, "email": grant.email})
        ctx.set_session_cookie(response, grant.token, grant.max_age)
        return response

    @endpoint
    async def login(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        email, password = ctx.field(data, "email"), ctx.field(data, "password")
        grant = await run_in_threadpool(auth.login, email, password, client_of(request))
        # Rotaciona: qualquer sessão anterior deste navegador é encerrada.
        await run_in_threadpool(auth.logout, request.cookies.get(cookie_name))
        response = JSONResponse({"authenticated": True, "email": grant.email})
        ctx.set_session_cookie(response, grant.token, grant.max_age)
        return response

    @endpoint
    async def logout(request: Request) -> Response:
        auth = ctx.require_auth()
        ctx.check_origin(request)
        await run_in_threadpool(auth.logout, request.cookies.get(cookie_name))
        response = JSONResponse({"authenticated": False})
        ctx.clear_session_cookie(response)
        return response

    @endpoint
    async def request_reset(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        message = await run_in_threadpool(
            auth.request_password_reset, ctx.field(data, "email"), client_of(request)
        )
        task = BackgroundTask(auth.deliver, message) if message else None
        return JSONResponse({"status": "accepted"}, status_code=202, background=task)

    @endpoint
    async def confirm_reset(request: Request) -> Response:
        auth = ctx.require_auth()
        data = await ctx.read_json(request)
        token = ctx.field(data, "token", TOKEN_MAX_LENGTH)
        password = ctx.field(data, "password")
        await run_in_threadpool(auth.reset_password, token, password, client_of(request))
        response = JSONResponse({"status": "password_updated"})
        ctx.clear_session_cookie(response)
        return response

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        if auth is not None:
            await run_in_threadpool(auth.initialize)
            if chat is not None:
                await run_in_threadpool(chat.initialize)
        try:
            yield
        finally:
            if chat is not None:
                chat.shutdown()

    routes = [
        Route("/", page("index.html")),
        # Links diretos para conversas abrem o mesmo app; a posse é checada na API.
        Route("/c/{conversation_id}", page("index.html")),
        Route("/termos", page("termos.html")),
        Route("/privacidade", page("privacidade.html")),
        Route("/manifest.webmanifest", page("manifest.webmanifest", "application/manifest+json")),
        Route("/sw.js", service_worker),
        Route("/api/health", health, methods=["GET"]),
        Route("/api/auth/session", session, methods=["GET"]),
        Route("/api/auth/register", register, methods=["POST"]),
        Route("/api/auth/verify-email", verify_email, methods=["POST"]),
        Route("/api/auth/verify-email/resend", resend_verification, methods=["POST"]),
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/logout", logout, methods=["POST"]),
        Route("/api/auth/password-reset", request_reset, methods=["POST"]),
        Route("/api/auth/password-reset/confirm", confirm_reset, methods=["POST"]),
        *chat_routes(ctx, chat),
        Mount("/assets", app=StaticFiles(directory=STATIC_DIR / "assets"), name="assets"),
    ]
    return Starlette(
        routes=routes,
        middleware=[Middleware(SecurityHeaders, hsts=settings.cookie_secure)],
        lifespan=lifespan,
    )
