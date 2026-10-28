"""Contrato de interface de linha de comando sem lógica de negócio."""

from typing import Any


class CliInterface:
    """Contrato de interface de linha de comando sem lógica de negócio."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
