"""Único módulo autorizado a resolver fontes de segredos; contrato ainda vazio."""

from typing import Protocol


class SecretProvider(Protocol):
    """Interface de provedor de segredo com acesso por identificador autorizado."""

    def get_secret(self, secret_name: str, *, scope: str) -> str:
        """Obtém credencial limitada a um escopo após autorização."""
        ...


def get_secret(secret_name: str, *, scope: str) -> str:
    """Resolve segredo por backend seguro; nunca registrar valor retornado."""
    raise NotImplementedError("Provedor seguro de segredos ainda não configurado.")
