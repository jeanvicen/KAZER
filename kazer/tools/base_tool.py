"""Contrato comum e mínimo para ferramentas invocáveis pelo agente."""

from abc import ABC, abstractmethod
from enum import StrEnum
from typing import Any, ClassVar
from pydantic import BaseModel


class Permission(StrEnum):
    """Categorias de autorização que uma ferramenta pode solicitar."""

    READ = "read"
    WRITE = "write"
    NETWORK = "network"
    SHELL = "shell"
    FILESYSTEM = "filesystem"
    ADMIN = "admin"


class ToolResult(BaseModel):
    """Resultado estruturado sem garantia de confiança no conteúdo externo."""

    success: bool
    summary: str
    data: dict[str, Any] | None = None


class BaseTool(ABC):
    """Ferramenta declarativa; registro não representa autorização."""

    name: ClassVar[str]
    description: ClassVar[str]
    input_schema: ClassVar[type[BaseModel]]
    permissions: ClassVar[frozenset[Permission]]
    destructive: ClassVar[bool] = False

    @abstractmethod
    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa ação somente após validação externa por tool_guard."""
        raise NotImplementedError
