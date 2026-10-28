"""Contratos para eventos internos minimizados e auditáveis."""

from datetime import datetime
from pydantic import Field
from kazer.config.models import StrictModel


class AgentEvent(StrictModel):
    """Evento de domínio; payload não deve incluir segredos ou conteúdo pessoal."""

    event_id: str
    event_type: str
    task_id: str
    occurred_at: datetime
    attributes: dict[str, str] = Field(default_factory=dict)
