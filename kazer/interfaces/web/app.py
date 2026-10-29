"""Aplicação ASGI: serve a tela de entrada e a API `/api/auth/*`.

Defesas na borda: CSP sem origens externas, verificação de `Origin` contra CSRF,
somente JSON com corpo limitado, cookie de sessão HttpOnly/SameSite e cabeçalhos
que desligam cache, referer e APIs sensíveis do navegador.
"""

import json
import logging
import math
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

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
from kazer.auth.supabase_service import SupabaseAuthService
from kazer.auth.store import AuthStore
from kazer.config.settings import Settings, load_settings
from kazer.integrations.email import build_mail_sender
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter

logger = logging.getLogger("kazer.web")

STATIC_DIR = Path(__file__).parent / "static"
MAX_BODY_BYTES = 4096
FIELD_MAX_LENGTH = 1024

_CSP = "; ".join(
    (
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
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


def _error(exc: AuthError) -> JSONResponse:
    body: dict[str, Any] = {"error": exc.code}
    headers: dict[str, str] = {}
    if exc.retry_after > 0:
        seconds = math.ceil(exc.retry_after)
        body["retry_after"] = seconds
        headers["Retry-After"] = str(seconds)
    return JSONResponse(body, status_code=exc.status, headers=headers)


Handler = Callable[[Request], Awaitable[Response]]


def _endpoint(handler: Handler) -> Handler:
    async def wrapped(request: Request) -> Response:
        try:
            return await handler(request)
        except AuthError as exc:
            return _error(exc)

    return wrapped


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _build_service(settings: Settings) -> AuthService | SupabaseAuthService | None:
    """Cria o serviço real ou None quando a configuração não permite operar com segurança."""
    if settings.supabase_configured:
        return SupabaseAuthService(
            settings.supabase_url,
            settings.supabase_publishable_key,
            settings.supabase_auth_redirect_url or settings.public_origin,
            RateLimiter(),
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


def create_app(
    settings: Settings | None = None,
    service: AuthService | SupabaseAuthService | None = None,
) -> Starlette:
    """Monta a aplicação com dependências reais ou injetadas (testes)."""
    settings = settings or load_settings()
    auth = service if service is not None else _build_service(settings)
    cookie_name = "__Host-kazer_session" if settings.cookie_secure else "kazer_session"
    public_origin = settings.public_origin

    def check_origin(request: Request) -> None:
        # Defesa CSRF por cabeçalhos padrão (OWASP): POST só da própria origem.
        origin = request.headers.get("origin", "")
        same_host = urlsplit(origin).netloc == request.headers.get("host", "")
        if not origin or not (origin == public_origin or same_host):
            raise AuthError("forbidden_origin", 403)
        fetch_site = request.headers.get("sec-fetch-site")
        if fetch_site is not None and fetch_site != "same-origin":
            raise AuthError("forbidden_origin", 403)

    async def read_json(request: Request) -> dict[str, Any]:
        check_origin(request)
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            raise AuthError("unsupported_media_type", 415)
        body = b""
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_BODY_BYTES:
                raise AuthError("payload_too_large", 413)
        try:
            data = json.loads(body)
        except ValueError:
            raise AuthError("invalid_request", 400) from None
        if not isinstance(data, dict):
            raise AuthError("invalid_request", 400)
        return data

    def require_auth() -> AuthService | SupabaseAuthService:
        if auth is None:
            raise AuthError("auth_unavailable", 503)
        return auth

    def field(data: dict[str, Any], name: str) -> str:
        value = data.get(name)
        if not isinstance(value, str) or len(value) > FIELD_MAX_LENGTH:
            raise AuthError("invalid_request", 400)
        return value

    def set_session_cookie(response: Response, token: str, max_age: int) -> None:
        response.set_cookie(
            cookie_name,
            token,
            max_age=max_age,
            path="/",
            secure=settings.cookie_secure,
            httponly=True,
            samesite="lax",
        )

    def clear_session_cookie(response: Response) -> None:
        response.delete_cookie(
            cookie_name, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax"
        )

    def page(name: str, media_type: str = "text/html") -> Callable[[Request], Awaitable[Response]]:
        async def serve(request: Request) -> Response:
            return FileResponse(
                STATIC_DIR / name, media_type=media_type, headers={"Cache-Control": "no-cache"}
            )

        return serve

    @_endpoint
    async def session(request: Request) -> Response:
        if auth is None:
            return JSONResponse({"authenticated": False, "available": False})
        token = request.cookies.get(cookie_name)
        email = await run_in_threadpool(auth.session_email, token)
        if email is None:
            response = JSONResponse({"authenticated": False})
            if token:
                clear_session_cookie(response)
            return response
        return JSONResponse({"authenticated": True, "email": email})

    @_endpoint
    async def register(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        email, password = field(data, "email"), field(data, "password")
        await run_in_threadpool(auth.register, email, password, _client(request))
        return JSONResponse({"status": "verification_sent"}, status_code=202)

    @_endpoint
    async def resend_verification(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        message = await run_in_threadpool(
            auth.resend_verification, field(data, "email"), _client(request)
        )
        task = BackgroundTask(auth.deliver, message) if message else None
        return JSONResponse({"status": "accepted"}, status_code=202, background=task)

    @_endpoint
    async def verify_email(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        await run_in_threadpool(auth.verify_email, field(data, "token"), _client(request))
        return JSONResponse({"status": "verified"})

    @_endpoint
    async def login(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        email, password = field(data, "email"), field(data, "password")
        grant = await run_in_threadpool(auth.login, email, password, _client(request))
        # Rotaciona: qualquer sessão anterior deste navegador é encerrada.
        await run_in_threadpool(auth.logout, request.cookies.get(cookie_name))
        response = JSONResponse({"authenticated": True, "email": grant.email})
        set_session_cookie(response, grant.token, grant.max_age)
        return response

    @_endpoint
    async def logout(request: Request) -> Response:
        auth = require_auth()
        check_origin(request)
        await run_in_threadpool(auth.logout, request.cookies.get(cookie_name))
        response = JSONResponse({"authenticated": False})
        clear_session_cookie(response)
        return response

    @_endpoint
    async def request_reset(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        message = await run_in_threadpool(
            auth.request_password_reset, field(data, "email"), _client(request)
        )
        task = BackgroundTask(auth.deliver, message) if message else None
        return JSONResponse({"status": "accepted"}, status_code=202, background=task)

    @_endpoint
    async def confirm_reset(request: Request) -> Response:
        auth = require_auth()
        data = await read_json(request)
        token, password = field(data, "token"), field(data, "password")
        await run_in_threadpool(auth.reset_password, token, password, _client(request))
        response = JSONResponse({"status": "password_updated"})
        clear_session_cookie(response)
        return response

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        if auth is not None:
            await run_in_threadpool(auth.initialize)
        yield

    routes = [
        Route("/", page("index.html")),
        Route("/termos", page("termos.html")),
        Route("/privacidade", page("privacidade.html")),
        Route("/manifest.webmanifest", page("manifest.webmanifest", "application/manifest+json")),
        Route("/api/auth/session", session, methods=["GET"]),
        Route("/api/auth/register", register, methods=["POST"]),
        Route("/api/auth/verify-email", verify_email, methods=["POST"]),
        Route("/api/auth/verify-email/resend", resend_verification, methods=["POST"]),
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/logout", logout, methods=["POST"]),
        Route("/api/auth/password-reset", request_reset, methods=["POST"]),
        Route("/api/auth/password-reset/confirm", confirm_reset, methods=["POST"]),
        Mount("/assets", app=StaticFiles(directory=STATIC_DIR / "assets"), name="assets"),
    ]
    return Starlette(
        routes=routes,
        middleware=[Middleware(SecurityHeaders, hsts=settings.cookie_secure)],
        lifespan=lifespan,
    )
