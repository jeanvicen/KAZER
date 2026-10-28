"""Chamadas API somente a destinos e escopos previamente autorizados."""

from typing import ClassVar
from pydantic import BaseModel, ConfigDict

from kazer.tools.base_tool import BaseTool, Permission, ToolResult


class ApiClientToolInput(BaseModel):
    """Schema inicial estrito; campos operacionais serão definidos na implementação."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ApiClientTool(BaseTool):
    """Chamadas API somente a destinos e escopos previamente autorizados."""

    name: ClassVar[str] = "api_client"
    description: ClassVar[str] = "Chamadas API somente a destinos e escopos previamente autorizados."
    input_schema: ClassVar[type[BaseModel]] = ApiClientToolInput
    permissions: ClassVar[frozenset[Permission]] = frozenset({
        Permission.NETWORK,
        Permission.READ,
    })
    destructive: ClassVar[bool] = False

    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa somente após passagem obrigatória pelo tool_guard."""
        raise NotImplementedError("Ferramenta intencionalmente não implementada.")
