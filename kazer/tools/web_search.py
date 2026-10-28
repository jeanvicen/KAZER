"""Pesquisa na web com resultados externos tratados como dados não confiáveis."""

from typing import ClassVar
from pydantic import BaseModel, ConfigDict

from kazer.tools.base_tool import BaseTool, Permission, ToolResult


class WebSearchToolInput(BaseModel):
    """Schema inicial estrito; campos operacionais serão definidos na implementação."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class WebSearchTool(BaseTool):
    """Pesquisa na web com resultados externos tratados como dados não confiáveis."""

    name: ClassVar[str] = "web_search"
    description: ClassVar[str] = "Pesquisa na web com resultados externos tratados como dados não confiáveis."
    input_schema: ClassVar[type[BaseModel]] = WebSearchToolInput
    permissions: ClassVar[frozenset[Permission]] = frozenset({
        Permission.NETWORK,
        Permission.READ,
    })
    destructive: ClassVar[bool] = False

    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa somente após passagem obrigatória pelo tool_guard."""
        raise NotImplementedError("Ferramenta intencionalmente não implementada.")
