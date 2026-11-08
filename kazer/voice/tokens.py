"""Tokens curtos e assinados para abrir uma sessão no voice gateway.

O KAZER (que conhece a conta pela sessão) emite; o gateway (que não tem banco
nem chaves de modelo) só confere a assinatura, a validade e o uso único. Nada
de cookie do navegador no gateway: o mesmo token serve para o app nativo.

Formato: base64url(JSON) "." base64url(HMAC-SHA256). Versão no campo "v".
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

VERSION = 1
DEFAULT_TTL = 60  # segundos: só o tempo de conectar
MAX_TOKEN_LENGTH = 1024
MIN_SECRET_LENGTH = 32


class VoiceTokenError(Exception):
    """Token recusado; o código é estável e não revela o motivo ao cliente."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class VoiceGrant:
    """O que o gateway pode confiar depois de conferir o token."""

    user_id: str
    conversation_id: str | None
    nonce: str
    expires_at: int
    max_seconds: int


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _check_secret(secret: str) -> bytes:
    if len(secret) < MIN_SECRET_LENGTH:
        raise ValueError("KAZER_VOICE_TOKEN_SECRET precisa de 32+ caracteres.")
    return secret.encode("utf-8")


def issue(
    secret: str,
    user_id: str,
    *,
    conversation_id: str | None = None,
    ttl: int = DEFAULT_TTL,
    max_seconds: int = 600,
    now: float | None = None,
) -> tuple[str, int]:
    """Devolve (token, expira_em_unix)."""
    key = _check_secret(secret)
    issued = int(now if now is not None else time.time())
    payload = {
        "v": VERSION,
        "sub": user_id,
        "cid": conversation_id,
        "iat": issued,
        "exp": issued + ttl,
        "jti": secrets.token_urlsafe(16),
        "max": max_seconds,
    }
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = _b64(hmac.new(key, body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}", payload["exp"]


def verify(secret: str, token: str, *, now: float | None = None) -> VoiceGrant:
    """Confere assinatura, versão e validade. Não marca uso único (ver NonceStore)."""
    key = _check_secret(secret)
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
        raise VoiceTokenError("invalid_token")
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(key, body.encode("ascii"), hashlib.sha256).digest())
    except (ValueError, UnicodeEncodeError):
        raise VoiceTokenError("invalid_token") from None
    if not hmac.compare_digest(sig, expected):
        raise VoiceTokenError("invalid_token")
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, UnicodeDecodeError):
        raise VoiceTokenError("invalid_token") from None
    if not isinstance(payload, dict) or payload.get("v") != VERSION:
        raise VoiceTokenError("invalid_token")
    current = int(now if now is not None else time.time())
    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < current:
        raise VoiceTokenError("expired_token")
    sub, jti = payload.get("sub"), payload.get("jti")
    if not isinstance(sub, str) or not sub or not isinstance(jti, str) or not jti:
        raise VoiceTokenError("invalid_token")
    cid = payload.get("cid")
    max_seconds = payload.get("max")
    return VoiceGrant(
        user_id=sub,
        conversation_id=cid if isinstance(cid, str) else None,
        nonce=jti,
        expires_at=exp,
        max_seconds=max_seconds if isinstance(max_seconds, int) and max_seconds > 0 else 600,
    )


class NonceStore:
    """Uso único dos tokens dentro de UMA instância do gateway.

    Com mais de uma instância, troque por um armazenamento compartilhado
    (Valkey: SET jti NX EX ttl) — documentado em docs/voice/CAPACITY.md.
    """

    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def use(self, nonce: str, expires_at: int, *, now: float | None = None) -> bool:
        current = int(now if now is not None else time.time())
        for key in [k for k, exp in self._seen.items() if exp < current]:
            del self._seen[key]
        if nonce in self._seen:
            return False
        self._seen[nonce] = expires_at
        return True
