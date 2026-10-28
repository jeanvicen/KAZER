"""Envio de mensagens externas exige aprovação humana por ação."""

from typing import ClassVar
from pydantic import BaseModel, ConfigDict

from kazer.tools.base_tool import BaseTool, Permission, ToolResult


class MessagingToolInput(BaseModel):
    """Schema inicial estrito; campos operacionais serão definidos na implementação."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class MessagingTool(BaseTool):
    """Envio de mensagens externas exige aprovação humana por ação."""

    name: ClassVar[str] = "messaging"
    description: ClassVar[str] = "Envio de mensagens externas exige aprovação humana por ação."
    input_schema: ClassVar[type[BaseModel]] = MessagingToolInput
    permissions: ClassVar[frozenset[Permission]] = frozenset({
        Permission.NETWORK,
        Permission.WRITE,
    })
    destructive: ClassVar[bool] = True

    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa somente após passagem obrigatória pelo tool_guard."""
        raise NotImplementedError("Ferramenta intencionalmente não implementada.")
