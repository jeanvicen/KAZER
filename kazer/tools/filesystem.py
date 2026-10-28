"""Acesso restrito ao workspace, sem caminhos fora do escopo autorizado."""

from typing import ClassVar
from pydantic import BaseModel, ConfigDict

from kazer.tools.base_tool import BaseTool, Permission, ToolResult


class FilesystemToolInput(BaseModel):
    """Schema inicial estrito; campos operacionais serão definidos na implementação."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class FilesystemTool(BaseTool):
    """Acesso restrito ao workspace, sem caminhos fora do escopo autorizado."""

    name: ClassVar[str] = "filesystem"
    description: ClassVar[str] = "Acesso restrito ao workspace, sem caminhos fora do escopo autorizado."
    input_schema: ClassVar[type[BaseModel]] = FilesystemToolInput
    permissions: ClassVar[frozenset[Permission]] = frozenset({
        Permission.FILESYSTEM,
        Permission.READ,
        Permission.WRITE,
    })
    destructive: ClassVar[bool] = False

    async def execute(self, arguments: BaseModel) -> ToolResult:
        """Executa somente após passagem obrigatória pelo tool_guard."""
        raise NotImplementedError("Ferramenta intencionalmente não implementada.")
