"""Fronteira obrigatória de autorização de chamadas de ferramenta."""

from dataclasses import dataclass
from kazer.tools.base_tool import Permission


@dataclass(frozen=True, slots=True)
class ToolAuthorizationRequest:
    """Pedido limitado de autorização, sem incluir valores secretos."""

    user_id: str
    session_id: str
    tool_name: str
    permissions: frozenset[Permission]
    requires_human_approval: bool


def authorize_tool_call(request: ToolAuthorizationRequest) -> None:
    """Valida identidade, política, escopo e aprovação; falha fechada."""
    raise NotImplementedError("Autorização de ferramentas ainda não implementada.")
