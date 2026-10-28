"""Contrato de webhook com validação e autenticação futura."""

from typing import Any


class WebhookInterface:
    """Contrato de webhook com validação e autenticação futura."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
