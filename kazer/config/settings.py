"""Ponto único futuro para carregar e validar configuração não secreta."""

from kazer.config.models import StrictModel


class Settings(StrictModel):
    """Configuração operacional sem campos de credenciais."""

    environment: str = "development"
    log_level: str = "INFO"


def load_settings() -> Settings:
    """Carrega configuração validada; leitura de segredos é proibida aqui."""
    raise NotImplementedError("Carregamento de configuração ainda não implementado.")
