"""Contrato para pesquisa web com resultados externos não confiáveis."""

from typing import Any


class WebSearchTool:
    """Contrato para pesquisa web com resultados externos não confiáveis."""

    def __init__(self) -> None:
        """Reserva ponto de injeção de dependências; sem efeitos colaterais."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        """Representa operação futura, ainda sem implementação."""
        raise NotImplementedError("Este contrato ainda não foi implementado.")
