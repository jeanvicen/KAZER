"""Tipos de estado isolado para sessões e tarefas do agente."""

from enum import StrEnum
from pydantic import Field
from kazer.config.models import StrictModel


class TaskStatus(StrEnum):
    """Estados conceituais de uma tarefa."""

    PENDING = "pending"
    PLANNING = "planning"
    WAITING_APPROVAL = "waiting_approval"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskState(StrictModel):
    """Estado serializável de uma tarefa sem dados sensíveis."""

    task_id: str
    user_id: str
    session_id: str
    project_id: str | None = None
    status: TaskStatus = TaskStatus.PENDING
    step_ids: tuple[str, ...] = Field(default_factory=tuple)
