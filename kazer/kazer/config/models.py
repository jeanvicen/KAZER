"""Contratos tipados compartilhados para configurações validadas."""

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """Base para contratos que rejeitam campos inesperados."""

    model_config = ConfigDict(extra="forbid", frozen=True)
