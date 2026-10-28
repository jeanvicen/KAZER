"""Contrato de API sem endpoints operacionais nesta fase."""

from typing import Any


class ApiInterface:
    """Contrato de API sem endpoints operacionais nesta fase."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
