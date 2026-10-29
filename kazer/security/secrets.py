"""Único módulo autorizado a resolver fontes de segredos."""

import os
from collections.abc import Mapping
from typing import Protocol

# Allowlist por escopo: um adaptador só obtém os segredos do próprio escopo.
_ALLOWED_SECRETS: Mapping[str, frozenset[str]] = {
    "email": frozenset({"SMTP_PASSWORD"}),
    # Chave de serviço do Supabase: só para a exclusão de conta pela API admin.
    "supabase_admin": frozenset({"SUPABASE_SERVICE_ROLE_KEY"}),
    # Chaves do provedor de modelo: lidas só pelo adaptador, nunca expostas ao navegador.
    "model": frozenset(
        {
            "XAI_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "GROQ_API_KEY",
            "DEEPSEEK_API_KEY",
            "MISTRAL_API_KEY",
            "OPENROUTER_API_KEY",
            "TOGETHER_API_KEY",
            "KAZER_MODEL_API_KEY",
        }
    ),
}


class SecretProvider(Protocol):
    """Interface de provedor de segredo com acesso por identificador autorizado."""

    def get_secret(self, secret_name: str, *, scope: str) -> str:
        """Obtém credencial limitada a um escopo após autorização."""
        ...


class SecretNotConfiguredError(LookupError):
    """Segredo autorizado, porém ausente; a mensagem nunca inclui valores."""


class EnvironmentSecretProvider:
    """Lê segredos injetados no ambiente pelo gerenciador da plataforma."""

    def __init__(self, environ: Mapping[str, str] | None = None) -> None:
        """Permite injetar o ambiente em testes; padrão é `os.environ`."""
        self._environ = os.environ if environ is None else environ

    def get_secret(self, secret_name: str, *, scope: str) -> str:
        """Nega por padrão nomes fora da allowlist do escopo."""
        if secret_name not in _ALLOWED_SECRETS.get(scope, frozenset()):
            raise PermissionError(f"Segredo {secret_name!r} não autorizado no escopo {scope!r}.")
        value = self._environ.get(secret_name, "")
        if not value:
            raise SecretNotConfiguredError(f"Segredo {secret_name!r} não configurado.")
        return value


def get_secret(secret_name: str, *, scope: str) -> str:
    """Resolve segredo pelo provedor padrão; nunca registrar valor retornado."""
    return EnvironmentSecretProvider().get_secret(secret_name, scope=scope)
