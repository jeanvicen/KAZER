"""Token da sessão em curso, para o store do Supabase falar como a própria pessoa.

O token vive num `ContextVar`: cada requisição tem o seu, inclusive quando a
rota roda a parte síncrona numa thread auxiliar (o contexto é copiado junto).
A thread que gera a resposta roda fora da requisição, então ela recebe o token
explicitamente em `bind_access_token`.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_token: ContextVar[str | None] = ContextVar("kazer_access_token", default=None)


def set_access_token(token: str | None) -> None:
    """Guarda o token desta requisição."""
    _token.set(token)


def current_access_token() -> str | None:
    """Token da requisição em curso, ou None (aí o store usa a chave de serviço)."""
    return _token.get()


@contextmanager
def bind_access_token(token: str | None) -> Iterator[None]:
    """Aplica um token num bloco (usado pela thread de geração)."""
    reset = _token.set(token)
    try:
        yield
    finally:
        _token.reset(reset)
