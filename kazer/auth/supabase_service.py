"""Supabase Auth adapter for the existing KAZER HTTP contract.

The access/refresh token bundle is kept only in the HttpOnly cookie by the web
layer. This module never persists passwords, tokens, or user records locally.
"""
import base64
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from kazer.auth.service import AuthError, AuthPolicy, SessionGrant, _account_key
from kazer.auth.store import User
from kazer.auth.validation import ValidationError, validate_email, validate_password
from kazer.integrations.email import MailMessage, MailSender
from kazer.security.rate_limiter import RateLimit, RateLimiter

logger = logging.getLogger("kazer.auth.supabase")
TOKEN_MAX_LENGTH = 16384


@dataclass(frozen=True, slots=True)
class SupabaseSession:
    access_token: str
    refresh_token: str
    expires_in: int
    email: str

    def encode(self) -> str:
        raw = json.dumps(
            {"a": self.access_token, "r": self.refresh_token},
            separators=(",", ":"),
        ).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    @classmethod
    def decode(cls, token: str) -> tuple[str, str] | None:
        if not token or len(token) > TOKEN_MAX_LENGTH:
            return None
        try:
            padded = token + "=" * (-len(token) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded).decode())
            access, refresh = data["a"], data["r"]
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return None
        if not isinstance(access, str) or not isinstance(refresh, str):
            return None
        return access, refresh


class SupabaseAuthService:
    """Synchronous adapter compatible with the existing web route contract."""

    def __init__(
        self,
        url: str,
        publishable_key: str,
        public_origin: str,
        limiter: RateLimiter,
        mailer: MailSender | None = None,
        policy: AuthPolicy | None = None,
        client: httpx.Client | None = None,
        clock: Callable[[], float] | None = None,
        service_role_key: str | None = None,
    ) -> None:
        self._base = url.rstrip("/") + "/auth/v1"
        self._key = publishable_key
        # Só para a exclusão de conta (API admin); nunca sai do servidor.
        self._service_key = service_role_key
        self._origin = public_origin.rstrip("/")
        self._limiter = limiter
        self._mailer = mailer
        self._policy = policy or AuthPolicy()
        self._client = client or httpx.Client(timeout=12.0)

    def initialize(self) -> None:
        """Supabase owns schema and Auth initialization; there is no local store."""

    def deliver(self, message: MailMessage) -> None:
        """O Supabase envia os próprios e-mails; aqui só há entrega se houver mailer."""
        if self._mailer is not None:
            self._mailer.send(message)

    def _limit(self, key: str, limit: RateLimit) -> None:
        wait = self._limiter.hit(key, limit)
        if wait > 0:
            raise AuthError("rate_limited", 429, retry_after=wait)

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = {"apikey": self._key, "Content-Type": "application/json"}
        headers.update(kwargs.pop("headers", {}))
        try:
            response = self._client.request(method, self._base + path, headers=headers, **kwargs)
        except httpx.HTTPError:
            raise AuthError("auth_unavailable", 503) from None
        return response

    @staticmethod
    def _email(raw: str) -> str:
        try:
            return validate_email(raw)
        except ValidationError as exc:
            raise AuthError(exc.code, 422) from None

    @staticmethod
    def _password(password: str, email: str) -> None:
        try:
            validate_password(password, email)
        except ValidationError as exc:
            raise AuthError(exc.code, 422) from None

    @staticmethod
    def _json(response: httpx.Response) -> dict[str, Any]:
        try:
            value = response.json()
        except ValueError:
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _is_recovery_token(token: str) -> bool:
        """Accept only the JWT type issued after a password-recovery link."""
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return False
            padded = parts[1] + "=" * (-len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(padded).decode())
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return False
        return bool(claims.get("type") == "recovery")

    def register(self, raw_email: str, password: str, client: str) -> None:
        self._limit(f"register:{client}", self._policy.register_per_client)
        email = self._email(raw_email)
        self._password(password, email)
        response = self._request(
            "POST",
            "/signup",
            json={
                "email": email,
                "password": password,
                "options": {"email_redirect_to": self._origin + "/"},
            },
        )
        if response.status_code not in (200, 201):
            body = self._json(response)
            message = str(body.get("msg", body.get("message", ""))).lower()
            if "rate" in message or response.status_code == 429:
                raise AuthError("rate_limited", 429)
            if "password" in message:
                raise AuthError("password_too_common", 422)
            # Keep signup responses generic to avoid account enumeration.
            logger.info("auth.register.rejected")
            return
        logger.info("auth.register.accepted")

    def resend_verification(self, raw_email: str, client: str) -> MailMessage | None:
        self._limit(f"mail:{client}", self._policy.mail_per_client)
        email = self._email(raw_email)
        response = self._request(
            "POST",
            "/resend",
            json={
                "type": "signup",
                "email": email,
                "options": {"email_redirect_to": self._origin + "/"},
            },
        )
        if response.status_code not in (200, 204):
            return None
        return None

    def verify_email(
        self, token: str, client: str, refresh_token: str | None = None
    ) -> SessionGrant | None:
        """Confere o link; com o refresh token do mesmo link, já devolve a sessão."""
        self._limit(f"token:{client}", self._policy.token_per_client)
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {token}"})
        if response.status_code != 200:
            raise AuthError("invalid_token", 400)
        email = self._json(response).get("email")
        if not refresh_token or not isinstance(email, str):
            return None
        session = SupabaseSession(token, refresh_token, 3600, email)
        return SessionGrant(session.encode(), email, self._policy.session_ttl)

    def login(self, raw_email: str, password: str, client: str) -> SessionGrant:
        self._limit(f"login:{client}", self._policy.login_per_client)
        try:
            email = validate_email(raw_email)
        except ValidationError:
            raise AuthError("invalid_credentials", 401) from None
        response = self._request(
            "POST", "/token?grant_type=password", json={"email": email, "password": password}
        )
        body = self._json(response)
        if response.status_code != 200:
            message = str(body.get("msg", body.get("error_description", ""))).lower()
            if "confirm" in message or "verified" in message:
                raise AuthError("email_not_verified", 403)
            raise AuthError("invalid_credentials", 401)
        user = body.get("user") or {}
        user_email = user.get("email")
        access, refresh = body.get("access_token"), body.get("refresh_token")
        if not (
            isinstance(user_email, str) and isinstance(access, str) and isinstance(refresh, str)
        ):
            raise AuthError("auth_unavailable", 503)
        expires_in = int(body.get("expires_in", 3600))
        session = SupabaseSession(access, refresh, expires_in, user_email)
        self._limiter.reset(_account_key("login-fail", email))
        # O access token vence em ~1 h; o cookie guarda também o refresh token e a sessão é
        # renovada no servidor (resolve_session), então o cookie dura a sessão inteira.
        return SessionGrant(session.encode(), user_email, self._policy.session_ttl)

    @staticmethod
    def _epoch(value: Any) -> int | None:
        if not isinstance(value, str) or not value:
            return None
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None

    def _user_from(self, body: dict[str, Any]) -> User | None:
        user_id, email = body.get("id"), body.get("email")
        if not isinstance(user_id, str) or not isinstance(email, str):
            return None
        return User(
            id=user_id,
            email=email,
            password_hash="",
            created_at=self._epoch(body.get("created_at")) or int(time.time()),
            email_verified_at=self._epoch(body.get("email_confirmed_at")),
        )

    def _refresh(self, refresh_token: str) -> tuple[User, SessionGrant] | None:
        response = self._request(
            "POST", "/token?grant_type=refresh_token", json={"refresh_token": refresh_token}
        )
        body = self._json(response)
        access, refresh = body.get("access_token"), body.get("refresh_token")
        user = self._user_from(body.get("user") or {})
        if response.status_code != 200 or user is None:
            return None
        if not isinstance(access, str) or not isinstance(refresh, str):
            return None
        session = SupabaseSession(access, refresh, int(body.get("expires_in", 3600)), user.email)
        return user, SessionGrant(session.encode(), user.email, self._policy.session_ttl)

    def resolve_session(self, token: str | None) -> tuple[User | None, SessionGrant | None]:
        """Conta da sessão; renova o access token vencido e devolve o cookie novo."""
        decoded = SupabaseSession.decode(token or "")
        if decoded is None:
            return None, None
        access, refresh = decoded
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {access}"})
        if response.status_code == 200:
            return self._user_from(self._json(response)), None
        if response.status_code in (401, 403) and refresh:
            refreshed = self._refresh(refresh)
            if refreshed is not None:
                return refreshed
        return None, None

    def session_user(self, token: str | None) -> User | None:
        """Conta da sessão válida (sem renovar o cookie)."""
        return self.resolve_session(token)[0]

    def session_email(self, token: str | None) -> str | None:
        user = self.session_user(token)
        return None if user is None else user.email

    def _password_session(self, email: str, password: str) -> str:
        """Confirma a senha atual entrando de novo; devolve um access token novo."""
        response = self._request(
            "POST", "/token?grant_type=password", json={"email": email, "password": password}
        )
        access = self._json(response).get("access_token")
        if response.status_code != 200 or not isinstance(access, str):
            self._limiter.hit(
                _account_key("login-fail", email), self._policy.login_failures_per_account
            )
            raise AuthError("invalid_password", 403)
        return access

    def _confirm(self, user: User, password: str, client: str) -> str:
        self._limit(f"confirm:{client}", self._policy.login_per_client)
        wait = self._limiter.retry_after(
            _account_key("login-fail", user.email), self._policy.login_failures_per_account
        )
        if wait > 0:
            raise AuthError("rate_limited", 429, retry_after=wait)
        if len(password) > 1024:
            raise AuthError("invalid_password", 403)
        return self._password_session(user.email, password)

    def change_password(
        self, user: User, current: str, new: str, session_token: str, client: str
    ) -> None:
        """Troca a senha no Supabase e encerra as outras sessões."""
        access = self._confirm(user, current, client)
        self._password(new, user.email)
        updated = self._request(
            "PUT", "/user", headers={"Authorization": f"Bearer {access}"}, json={"password": new}
        )
        if updated.status_code != 200:
            raise AuthError("password_change_failed", 400)
        self.revoke_other_sessions(user, session_token)
        logger.info("auth.password_changed")

    def revoke_other_sessions(self, user: User, session_token: str) -> int:
        """Sai de todos os outros dispositivos (o Supabase não informa quantos)."""
        decoded = SupabaseSession.decode(session_token)
        if decoded is None:
            return 0
        self._request(
            "POST", "/logout?scope=others", headers={"Authorization": f"Bearer {decoded[0]}"}
        )
        return -1

    def delete_account(self, user: User, password: str, client: str) -> None:
        """Exclui a conta pela API admin; sem a chave de serviço, falha de forma honesta."""
        self._confirm(user, password, client)
        if not self._service_key:
            raise AuthError("account_delete_unavailable", 503)
        response = self._request(
            "DELETE",
            f"/admin/users/{user.id}",
            headers={"apikey": self._service_key, "Authorization": f"Bearer {self._service_key}"},
        )
        if response.status_code not in (200, 204):
            raise AuthError("account_delete_unavailable", 503)
        logger.info("auth.account_deleted")

    def logout(self, token: str | None) -> None:
        decoded = SupabaseSession.decode(token or "")
        if decoded is None:
            return
        self._request("POST", "/logout", headers={"Authorization": f"Bearer {decoded[0]}"})

    def request_password_reset(self, raw_email: str, client: str) -> MailMessage | None:
        self._limit(f"mail:{client}", self._policy.mail_per_client)
        email = self._email(raw_email)
        self._request(
            "POST", "/recover", json={"email": email, "redirect_to": self._origin + "/"}
        )
        return None

    def reset_password(self, token: str, password: str, client: str) -> None:
        self._limit(f"token:{client}", self._policy.token_per_client)
        # In the Supabase implicit flow, token is the access token received after
        # the recovery link. The browser never sends an arbitrary email as proof.
        if not self._is_recovery_token(token):
            raise AuthError("invalid_token", 400)
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {token}"})
        user = self._json(response)
        email = user.get("email")
        if response.status_code != 200 or not isinstance(email, str):
            raise AuthError("invalid_token", 400)
        self._password(password, email)
        updated = self._request(
            "PUT",
            "/user",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": password},
        )
        if updated.status_code != 200:
            raise AuthError("invalid_token", 400)
