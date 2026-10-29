"""Ponto único para carregar e validar configuração não secreta."""

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from kazer.config.models import StrictModel

Environment = Literal["development", "test", "production"]
MailBackend = Literal["smtp", "file"]


class Settings(StrictModel):
    """Configuração operacional sem campos de credenciais."""

    environment: Environment = "development"
    log_level: str = "INFO"
    public_url: str = "http://localhost:8000"
    database_path: Path = Path("data/kazer.db")
    mail_backend: MailBackend = "file"
    mail_outbox_dir: Path = Path("data/outbox")
    mail_from: str = "KAZER <no-reply@localhost>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    cookie_secure: bool = True
    serverless: bool = False

    @property
    def auth_blockers(self) -> list[str]:
        """Motivos que impedem a autenticação de operar com segurança.

        Com qualquer bloqueio a tela continua no ar, mas a API de contas recusa
        as operações (falha fechada) em vez de simular um login sem persistência.
        """
        problems: list[str] = []
        if self.serverless:
            problems.append(
                "sem armazenamento persistente: o SQLite local não persiste em funções serverless"
            )
        if self.environment == "production":
            if urlsplit(self.public_url).scheme != "https":
                problems.append("KAZER_PUBLIC_URL deve usar https")
            if not self.cookie_secure:
                problems.append("KAZER_COOKIE_SECURE não pode ser desativado")
            if self.mail_backend != "smtp":
                problems.append("KAZER_MAIL_BACKEND deve ser smtp")
            if not self.smtp_host:
                problems.append("SMTP_HOST é obrigatório")
        return problems

    @property
    def public_origin(self) -> str:
        """Origem pública (esquema + host) usada em links enviados por e-mail."""
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}"


def _flag(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    """Carrega configuração validada; leitura de segredos é proibida aqui."""
    env = os.environ if environ is None else environ
    environment = env.get("KAZER_ENV", "development")
    # A Vercel define VERCEL=1 nas funções; lá o disco é somente leitura e efêmero.
    serverless = bool(env.get("VERCEL") or env.get("AWS_LAMBDA_FUNCTION_NAME"))
    values: dict[str, object] = {
        "environment": environment,
        "log_level": env.get("KAZER_LOG_LEVEL", "INFO"),
        "public_url": env.get("KAZER_PUBLIC_URL", "http://localhost:8000"),
        "database_path": env.get("KAZER_DATABASE_PATH", "data/kazer.db"),
        "mail_backend": env.get("KAZER_MAIL_BACKEND", "file"),
        "mail_outbox_dir": env.get("KAZER_MAIL_OUTBOX_DIR", "data/outbox"),
        "mail_from": env.get("KAZER_MAIL_FROM", "KAZER <no-reply@localhost>"),
        "smtp_host": env.get("SMTP_HOST", ""),
        "smtp_port": env.get("SMTP_PORT", "587"),
        "smtp_user": env.get("SMTP_USER", ""),
        # Cookies `Secure` por padrão; só o desenvolvimento local em http pode desligar.
        "cookie_secure": _flag(
            env.get("KAZER_COOKIE_SECURE"), environment == "production" or serverless
        ),
        "serverless": serverless,
    }
    return Settings.model_validate(values)
