"""Tokens opacos de sessão e de e-mail; o banco guarda apenas o hash."""

import hashlib
import secrets

TOKEN_BYTES = 32


def new_token() -> str:
    """Gera 256 bits aleatórios do CSPRNG do sistema, codificados para URL."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 basta para tokens de alta entropia; vazamento do banco não revela tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
