"""Adaptador isolado de envio de e-mail transacional (somente texto)."""

import logging
import os
import smtplib
import ssl
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Protocol

from kazer.config.settings import Settings
from kazer.security.secrets import get_secret

logger = logging.getLogger("kazer.email")


@dataclass(frozen=True, slots=True)
class MailMessage:
    """Mensagem mínima: sem HTML, imagens remotas ou pixels de rastreamento."""

    to: str
    subject: str
    body: str


class MailDeliveryError(RuntimeError):
    """Falha de entrega; a mensagem nunca carrega destinatário ou conteúdo."""


class MailSender(Protocol):
    """Contrato de envio usado pelo serviço de autenticação."""

    def send(self, message: MailMessage) -> None:
        """Entrega a mensagem ou lança `MailDeliveryError`."""
        ...


def _build(message: MailMessage, sender: str) -> EmailMessage:
    email = EmailMessage()
    email["From"] = sender
    email["To"] = message.to
    email["Subject"] = message.subject
    email["Date"] = formatdate(localtime=False)
    email["Message-ID"] = make_msgid(domain="kazer.local")
    # Corpo ASCII vai em 7bit: links ficam íntegros mesmo no arquivo bruto.
    if message.body.isascii():
        email.set_content(message.body, cte="7bit")
    else:
        email.set_content(message.body)
    return email


class SmtpMailSender:
    """Envio por SMTP com TLS obrigatório (STARTTLS ou TLS implícito na porta 465)."""

    def __init__(
        self,
        host: str,
        port: int,
        sender: str,
        username: str = "",
        password_provider: Callable[[], str] | None = None,
        timeout: float = 10.0,
    ) -> None:
        """A senha é obtida sob demanda e nunca armazenada no objeto."""
        self._host = host
        self._port = port
        self._sender = sender
        self._username = username
        self._password_provider = password_provider
        self._timeout = timeout

    def send(self, message: MailMessage) -> None:
        """Abre conexão curta, autentica se configurado e entrega."""
        context = ssl.create_default_context()
        try:
            smtp: smtplib.SMTP
            if self._port == 465:
                smtp = smtplib.SMTP_SSL(
                    self._host, self._port, timeout=self._timeout, context=context
                )
            else:
                smtp = smtplib.SMTP(self._host, self._port, timeout=self._timeout)
            with smtp:
                if self._port != 465:
                    smtp.starttls(context=context)
                if self._username and self._password_provider is not None:
                    smtp.login(self._username, self._password_provider())
                smtp.send_message(_build(message, self._sender))
        except (OSError, LookupError, smtplib.SMTPException) as exc:
            logger.warning("mail.delivery_failed", extra={"error_type": type(exc).__name__})
            raise MailDeliveryError("Falha ao entregar e-mail.") from None


class FileOutboxMailSender:
    """Caixa de saída local (.eml) para desenvolvimento; proibida em produção."""

    def __init__(self, directory: Path, sender: str) -> None:
        """Cria o diretório com permissão restrita ao usuário atual."""
        self._directory = directory
        self._sender = sender

    def send(self, message: MailMessage) -> None:
        """Grava a mensagem com permissão 0600 em `data/outbox/` (ignorado pelo git)."""
        try:
            self._directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self._directory / f"{int(time.time())}-{uuid.uuid4().hex[:8]}.eml"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(_build(message, self._sender).as_bytes())
        except OSError as exc:
            logger.warning("mail.outbox_failed", extra={"error_type": type(exc).__name__})
            raise MailDeliveryError("Falha ao gravar e-mail local.") from None


def _smtp_password() -> str:
    return get_secret("SMTP_PASSWORD", scope="email")


def build_mail_sender(settings: Settings) -> MailSender:
    """Escolhe o backend configurado; a senha SMTP passa por `security.secrets`."""
    if settings.mail_backend == "smtp":
        password_provider: Callable[[], str] | None = None
        if settings.smtp_user:
            _smtp_password()  # falha fechada na inicialização se o segredo faltar
            password_provider = _smtp_password
        return SmtpMailSender(
            settings.smtp_host,
            settings.smtp_port,
            settings.mail_from,
            settings.smtp_user,
            password_provider,
        )
    return FileOutboxMailSender(settings.mail_outbox_dir, settings.mail_from)
