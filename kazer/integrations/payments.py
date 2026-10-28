"""Adaptador de pagamentos, sempre sujeito a aprovação explícita."""

from typing import Any


class PaymentsIntegration:
    """Adaptador de pagamentos, sempre sujeito a aprovação explícita."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
