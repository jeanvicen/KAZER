"""Textos dos e-mails transacionais: texto puro, sem rastreamento nem imagens remotas.

Os tokens vão no fragmento (`#`) do link: o navegador não envia fragmentos ao
servidor, então eles não aparecem em logs de acesso nem em cabeçalhos Referer.
"""

import textwrap

from kazer.integrations.email import MailMessage


def _paragraphs(*parts: str) -> str:
    """Quebra a prosa em 72 colunas; linhas de link ficam intactas."""
    wrapped = [part if "://" in part else textwrap.fill(part, 72) for part in parts]
    return "\n\n".join(wrapped) + "\n"


def verification_message(to: str, origin: str, token: str) -> MailMessage:
    """Link de confirmação de e-mail (24 h, uso único)."""
    return MailMessage(
        to=to,
        subject="Confirm your KAZER account",
        body=_paragraphs(
            "Confirm the email address for your KAZER account:",
            f"{origin}/#verify={token}",
            "The link expires in 24 hours and works once.",
            "If you didn't create a KAZER account, ignore this message. "
            "Unconfirmed accounts are deleted automatically after 7 days.",
        ),
    )


def existing_account_message(to: str, origin: str) -> MailMessage:
    """Aviso enviado quando alguém tenta registrar um e-mail que já tem conta."""
    return MailMessage(
        to=to,
        subject="Your KAZER account",
        body=_paragraphs(
            "Someone tried to create a KAZER account with this email address, "
            "which already has one.",
            "If it was you, sign in or reset your password here:",
            f"{origin}/#recover",
            "If it wasn't you, no action is needed. Your account was not changed.",
        ),
    )


def password_reset_message(to: str, origin: str, token: str) -> MailMessage:
    """Link de redefinição de senha (30 min, uso único)."""
    return MailMessage(
        to=to,
        subject="Reset your KAZER password",
        body=_paragraphs(
            "Use this link to choose a new password for your KAZER account:",
            f"{origin}/#reset={token}",
            "The link expires in 30 minutes and works once. "
            "Changing your password signs you out on every device.",
            "If you didn't ask for this, ignore this message. Your password stays the same.",
        ),
    )
