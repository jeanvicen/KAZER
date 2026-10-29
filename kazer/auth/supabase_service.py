"""Supabase Auth adapter for the existing KAZER HTTP contract.

The access/refresh token bundle is kept only in the HttpOnly cookie by the web
layer. This module never persists passwords, tokens, or user records locally.
"""
import base64
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from kazer.auth.service import AuthError, AuthPolicy, SessionGrant, _account_key
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
    ) -> None:
        self._base = url.rstrip("/") + "/auth/v1"
        self._key = publishable_key
        self._origin = public_origin.rstrip("/")
        self._limiter = limiter
        self._mailer = mailer
        self._policy = policy or AuthPolicy()
        self._client = client or httpx.Client(timeout=12.0)

    def initialize(self) -> None:
        """Supabase owns schema and Auth initialization; there is no local store."""

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
            "POST", "/resend", json={"type": "signup", "email": email, "options": {"email_redirect_to": self._origin + "/"}}
        )
        if response.status_code not in (200, 204):
            return None
        return None

    def verify_email(self, token: str, client: str) -> None:
        self._limit(f"token:{client}", self._policy.token_per_client)
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {token}"})
        if response.status_code != 200:
            raise AuthError("invalid_token", 400)

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
        if not isinstance(user_email, str) or not isinstance(access, str) or not isinstance(refresh, str):
            raise AuthError("auth_unavailable", 503)
        expires_in = int(body.get("expires_in", 3600))
        session = SupabaseSession(access, refresh, expires_in, user_email)
        self._limiter.reset(_account_key("login-fail", email))
        return SessionGrant(session.encode(), user_email, min(expires_in, self._policy.session_ttl))

    def session_email(self, token: str | None) -> str | None:
        decoded = SupabaseSession.decode(token or "")
        if decoded is None:
            return None
        access, _ = decoded
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {access}"})
        if response.status_code != 200:
            return None
        email = self._json(response).get("email")
        return email if isinstance(email, str) else None

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
        response = self._request("GET", "/user", headers={"Authorization": f"Bearer {token}"})
        user = self._json(response)
        email = user.get("email")
        if response.status_code != 200 or not isinstance(email, str):
            raise AuthError("invalid_token", 400)
        self._password(password, email)
        updated = self._request(
            "PUT", "/user", headers={"Authorization": f"Bearer {token}"}, json={"password": password}
        )
        if updated.status_code != 200:
            raise AuthError("invalid_token", 400)
