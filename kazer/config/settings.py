"""Ponto único para carregar e validar configuração não secreta."""

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field

from kazer.config.models import StrictModel

Environment = Literal["development", "test", "production"]
MailBackend = Literal["smtp", "file"]
# Provedores aceitos para atender o "KAZ 1.1"; vazio = nenhum modelo conectado.
ModelProviderName = Literal[
    "",
    "xai",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "deepseek",
    "mistral",
    "openrouter",
    "together",
    "ollama",
    "custom",
]
# auto: o adaptador decide; effort: envia nível de raciocínio; off: nunca envia.
ModelReasoning = Literal["auto", "effort", "off"]


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
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_auth_redirect_url: str = ""
    cookie_secure: bool = True
    serverless: bool = False
    # Modelo por trás do "KAZ 1.1". Chaves NUNCA ficam aqui: só em kazer.security.secrets.
    model_provider: ModelProviderName = ""
    model_name: str = ""
    model_deep_name: str = ""
    model_base_url: str = ""
    model_vision: bool | None = None
    model_reasoning: ModelReasoning = "auto"
    model_web_search: bool = False
    model_max_output_tokens: int = Field(default=0, ge=0, le=128_000)
    model_timeout_seconds: float = Field(default=120.0, ge=5.0, le=600.0)
    # Anexos privados: fora da pasta pública, um diretório por conta.
    upload_dir: Path = Path("data/uploads")
    # Cota de uso no servidor, em unidades (mensagem = 1; pensamento profundo e busca somam).
    chat_hourly_units: int = Field(default=60, ge=1)
    chat_daily_units: int = Field(default=300, ge=1)
    # Histórico leve: a conversa mais antiga sai quando uma nova entra.
    chat_max_conversations: int = Field(default=100, ge=5, le=1000)

    @property
    def auth_blockers(self) -> list[str]:
        """Motivos que impedem a autenticação de operar com segurança.

        Com qualquer bloqueio a tela continua no ar, mas a API de contas recusa
        as operações (falha fechada) em vez de simular um login sem persistência.
        """
        problems: list[str] = []
        if self.serverless and not self.supabase_configured:
            problems.append(
                "sem armazenamento persistente: o SQLite local não persiste em funções serverless"
            )
        if self.environment == "production":
            if urlsplit(self.public_url).scheme != "https":
                problems.append("KAZER_PUBLIC_URL deve usar https")
            if not self.cookie_secure:
                problems.append("KAZER_COOKIE_SECURE não pode ser desativado")
            if not self.supabase_configured and self.mail_backend != "smtp":
                problems.append("KAZER_MAIL_BACKEND deve ser smtp")
            if not self.supabase_configured and not self.smtp_host:
                problems.append("SMTP_HOST é obrigatório")
        return problems

    @property
    def model_blockers(self) -> list[str]:
        """Problemas de configuração do modelo, sem nunca citar valores de chaves."""
        problems: list[str] = []
        if not self.model_provider:
            return ["KAZER_MODEL_PROVIDER não definido"]
        if self.model_provider != "anthropic" and not self.model_name:
            problems.append("KAZER_MODEL não definido")
        if self.model_provider == "custom" and not self.model_base_url:
            problems.append("KAZER_MODEL_BASE_URL é obrigatório para o provedor custom")
        if self.model_base_url:
            parts = urlsplit(self.model_base_url)
            local = parts.hostname in {"localhost", "127.0.0.1", "::1"}
            if parts.scheme not in {"https", "http"} or not parts.netloc:
                problems.append("KAZER_MODEL_BASE_URL inválida")
            elif parts.scheme == "http" and not local and self.environment == "production":
                problems.append("KAZER_MODEL_BASE_URL deve usar https fora do localhost")
        return problems

    @property
    def supabase_configured(self) -> bool:
        """Indica se o Auth pode operar sem usar o SQLite local."""
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def public_origin(self) -> str:
        """Origem pública (esquema + host) usada em links enviados por e-mail."""
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}"


def _flag(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _optional_flag(value: str | None) -> bool | None:
    if value is None or value.strip().lower() in {"", "auto"}:
        return None
    return _flag(value, False)


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
        "supabase_url": env.get("SUPABASE_URL", ""),
        "supabase_publishable_key": env.get("SUPABASE_PUBLISHABLE_KEY", ""),
        "supabase_auth_redirect_url": env.get(
            "SUPABASE_AUTH_REDIRECT_URL", env.get("KAZER_PUBLIC_URL", "http://localhost:8000")
        ),
        # Cookies `Secure` por padrão; só o desenvolvimento local em http pode desligar.
        "cookie_secure": _flag(
            env.get("KAZER_COOKIE_SECURE"), environment == "production" or serverless
        ),
        "serverless": serverless,
        "model_provider": env.get("KAZER_MODEL_PROVIDER", "").strip().lower(),
        "model_name": env.get("KAZER_MODEL", "").strip(),
        "model_deep_name": env.get("KAZER_MODEL_DEEP", "").strip(),
        "model_base_url": env.get("KAZER_MODEL_BASE_URL", "").strip().rstrip("/"),
        "model_vision": _optional_flag(env.get("KAZER_MODEL_VISION")),
        "model_reasoning": env.get("KAZER_MODEL_REASONING", "auto").strip().lower() or "auto",
        "model_web_search": _flag(env.get("KAZER_MODEL_WEB_SEARCH"), False),
        "model_max_output_tokens": env.get("KAZER_MODEL_MAX_TOKENS", "0").strip() or "0",
        "model_timeout_seconds": env.get("KAZER_MODEL_TIMEOUT", "120").strip() or "120",
        "upload_dir": env.get("KAZER_UPLOAD_DIR", "data/uploads"),
        "chat_hourly_units": env.get("KAZER_CHAT_HOURLY_UNITS", "60").strip() or "60",
        "chat_daily_units": env.get("KAZER_CHAT_DAILY_UNITS", "300").strip() or "300",
        "chat_max_conversations": env.get("KAZER_CHAT_MAX_CONVERSATIONS", "100").strip() or "100",
    }
    return Settings.model_validate(values)
