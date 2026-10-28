"""Execução de código apenas por runtime isolado e sandbox validada."""

from typing import ClassVar
from pydantic import BaseModel, ConfigDict

from kazer.tools.base_tool import BaseTool, Permission, ToolResult


class CodeRunnerToolInput(BaseModel):
    """Schema inicial estrito; campos operacionais serão definidos na implementação."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class CodeRunnerTool(BaseTool):
    """Execução de código apenas por runtime isolado e sandbox validada."""

    name: ClassVar[str] = "code_runner"
    description: ClassVar[str] = "Execução de código apenas por runtime isolado e sandbox validada."
    input_schema: ClassVar[type[BaseModel]] = CodeRunnerToolInput
    permissions: ClassVar[frozenset[Permission]] = frozenset({
        Permission.FILESYSTEM,
        Permission.SHELL,
    })
    destructive: ClassVar[bool] = False

    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa somente após passagem obrigatória pelo tool_guard."""
        raise NotImplementedError("Ferramenta intencionalmente não implementada.")
