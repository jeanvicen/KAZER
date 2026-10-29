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
        subject="Confirme sua conta KAZER",
        body=_paragraphs(
            "Confirme o e-mail da sua conta KAZER:",
            f"{origin}/#verify={token}",
            "O link vale por 24 horas e funciona uma única vez.",
            "Se você não criou uma conta no KAZER, ignore esta mensagem. "
            "Contas não confirmadas são apagadas automaticamente após 7 dias.",
        ),
    )


def existing_account_message(to: str, origin: str) -> MailMessage:
    """Aviso enviado quando alguém tenta registrar um e-mail que já tem conta."""
    return MailMessage(
        to=to,
        subject="Sua conta KAZER",
        body=_paragraphs(
            "Alguém tentou criar uma conta no KAZER com este e-mail, que já possui uma conta.",
            "Se foi você, entre ou redefina sua senha aqui:",
            f"{origin}/#recover",
            "Se não foi você, nenhuma ação é necessária. Sua conta não foi alterada.",
        ),
    )


def password_reset_message(to: str, origin: str, token: str) -> MailMessage:
    """Link de redefinição de senha (30 min, uso único)."""
    return MailMessage(
        to=to,
        subject="Redefina sua senha do KAZER",
        body=_paragraphs(
            "Use este link para criar uma nova senha para sua conta KAZER:",
            f"{origin}/#reset={token}",
            "O link vale por 30 minutos e funciona uma única vez. "
            "Ao trocar a senha, você sai de todos os dispositivos.",
            "Se você não pediu isso, ignore esta mensagem. Sua senha continua a mesma.",
        ),
    )
