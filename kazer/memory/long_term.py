"""Memória persistente sujeita a retenção e consentimento."""

from typing import Any


class LongTermMemory:
    """Memória persistente sujeita a retenção e consentimento."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
