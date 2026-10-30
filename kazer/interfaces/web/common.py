"""Peças compartilhadas pelas rotas: erros, CSRF, leitura de corpo e sessão."""

from __future__ import annotations

import json
import math
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from kazer.auth.service import AuthError, AuthService
from kazer.auth.store import User
from kazer.auth.supabase_service import SupabaseAuthService, SupabaseSession
from kazer.chat.identity import set_access_token
from kazer.chat.service import ChatError
from kazer.chat.supabase_store import StorageUnavailable

MAX_BODY_BYTES = 4096
FIELD_MAX_LENGTH = 1024
# Tokens de links do Supabase são JWTs (mais longos que os tokens locais).
TOKEN_MAX_LENGTH = 8192

Handler = Callable[[Request], Awaitable[Response]]


def error_response(exc: AuthError | ChatError) -> JSONResponse:
    """Erro estável em JSON; nunca inclui exceções internas."""
    body: dict[str, Any] = {"error": exc.code}
    if isinstance(exc, ChatError):
        body.update(exc.extra)
    headers: dict[str, str] = {}
    if exc.retry_after > 0:
        seconds = math.ceil(exc.retry_after)
        body["retry_after"] = seconds
        headers["Retry-After"] = str(seconds)
    return JSONResponse(body, status_code=exc.status, headers=headers)


def endpoint(handler: Handler) -> Handler:
    """Converte falhas esperadas em respostas JSON e grava o cookie renovado."""

    async def wrapped(request: Request) -> Response:
        try:
            response = await handler(request)
        except (AuthError, ChatError) as exc:
            response = error_response(exc)
        except StorageUnavailable:
            # Banco ou armazenamento do chat fora do ar: a interface avisa.
            response = error_response(ChatError("chat_unavailable", 503))
        renew = getattr(request.state, "renew_session", None)
        if renew is not None:
            renew(response)
        return response

    return wrapped


def client_of(request: Request) -> str:
    """Endereço do cliente só para limites de taxa (nunca registrado)."""
    return request.client.host if request.client else "unknown"


class WebContext:
    """Defesas de borda e resolução de sessão usadas por todas as rotas."""

    def __init__(
        self,
        *,
        auth: AuthService | SupabaseAuthService | None,
        cookie_name: str,
        public_origin: str,
        secure: bool,
    ) -> None:
        """`auth` None: contas fechadas neste ambiente (falha fechada)."""
        self.auth = auth
        self.cookie_name = cookie_name
        self.public_origin = public_origin
        self.secure = secure

    def check_origin(self, request: Request) -> None:
        """Defesa CSRF por cabeçalhos padrão (OWASP): escrita só da própria origem."""
        origin = request.headers.get("origin", "")
        same_host = urlsplit(origin).netloc == request.headers.get("host", "")
        if not origin or not (origin == self.public_origin or same_host):
            raise AuthError("forbidden_origin", 403)
        fetch_site = request.headers.get("sec-fetch-site")
        if fetch_site is not None and fetch_site != "same-origin":
            raise AuthError("forbidden_origin", 403)

    async def read_body(self, request: Request, limit: int) -> bytes:
        """Lê o corpo com teto, recusando cedo pelo Content-Length declarado."""
        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            raise AuthError("payload_too_large", 413)
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > limit:
                raise AuthError("payload_too_large", 413)
        return bytes(body)

    async def read_json(self, request: Request, limit: int = MAX_BODY_BYTES) -> dict[str, Any]:
        """Somente JSON, da própria origem e com tamanho limitado."""
        self.check_origin(request)
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            raise AuthError("unsupported_media_type", 415)
        body = await self.read_body(request, limit)
        try:
            data = json.loads(body)
        except ValueError:
            raise AuthError("invalid_request", 400) from None
        if not isinstance(data, dict):
            raise AuthError("invalid_request", 400)
        return data

    def require_auth(self) -> AuthService | SupabaseAuthService:
        """Serviço de contas ou 503 quando o ambiente não pode operar com segurança."""
        if self.auth is None:
            raise AuthError("auth_unavailable", 503)
        return self.auth

    async def user(self, request: Request) -> tuple[User, str]:
        """Conta da sessão validada no servidor; base de toda autorização.

        Se o provedor renovou a sessão (access token vencido), o cookie novo é
        gravado na própria resposta pelo `endpoint`.
        """
        auth = self.require_auth()
        token = request.cookies.get(self.cookie_name) or ""
        user, grant = await run_in_threadpool(auth.resolve_session, token)
        if user is None:
            raise AuthError("unauthenticated", 401)
        if grant is not None:
            request.state.renew_session = lambda response: self.set_session_cookie(
                response, grant.token, grant.max_age
            )
            token = grant.token
        # O store do chat no Supabase fala como a própria pessoa (RLS no banco).
        set_access_token(self.access_token(token))
        return user, token

    @staticmethod
    def access_token(cookie_token: str) -> str | None:
        """Access token de dentro do cookie de sessão (só o Supabase tem um)."""
        decoded = SupabaseSession.decode(cookie_token)
        return None if decoded is None else decoded[0]

    @staticmethod
    def field(data: dict[str, Any], name: str, max_length: int = FIELD_MAX_LENGTH) -> str:
        """Campo de texto obrigatório com tamanho limitado."""
        value = data.get(name)
        if not isinstance(value, str) or len(value) > max_length:
            raise AuthError("invalid_request", 400)
        return value

    def set_session_cookie(self, response: Response, token: str, max_age: int) -> None:
        """Cookie HttpOnly e SameSite=Lax; `Secure` fora do desenvolvimento local."""
        response.set_cookie(
            self.cookie_name,
            token,
            max_age=max_age,
            path="/",
            secure=self.secure,
            httponly=True,
            samesite="lax",
        )

    def clear_session_cookie(self, response: Response) -> None:
        """Apaga o cookie de sessão no navegador."""
        response.delete_cookie(
            self.cookie_name, path="/", secure=self.secure, httponly=True, samesite="lax"
        )
