"""Normalização e validação de credenciais, com códigos de erro estáveis."""

import re

EMAIL_MAX_LENGTH = 254
PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128

_CHAR = r"[^\s@\"<>()\[\],;:\\]"
_TLD = r"[^\s@\"<>()\[\],;:\\.]{2,}"
_EMAIL_PATTERN = re.compile(rf"^{_CHAR}{{1,64}}@{_CHAR}+\.{_TLD}$")

# Lista curta de senhas notoriamente vazadas que passariam pelo tamanho mínimo.
_COMMON_PASSWORDS = frozenset(
    {
        "1234567890",
        "12345678910",
        "123456789a",
        "0123456789",
        "0987654321",
        "1q2w3e4r5t",
        "1qaz2wsx3edc",
        "aaaaaaaaaa",
        "abcdefghij",
        "asdfghjkl;",
        "iloveyou12",
        "letmein123",
        "password12",
        "password123",
        "password1234",
        "passw0rd123",
        "qwertyuiop",
        "qwerty1234",
        "qwerty12345",
        "senha12345",
        "senha123456",
        "welcome123",
        "zxcvbnm123",
    }
)


class ValidationError(ValueError):
    """Erro de validação com código estável consumido pela interface."""

    def __init__(self, code: str) -> None:
        """Guarda apenas o código; nenhum valor do usuário entra na mensagem."""
        super().__init__(code)
        self.code = code


def normalize_email(raw: str) -> str:
    """Remove espaços e normaliza caixa para evitar contas duplicadas."""
    return raw.strip().lower()


def validate_email(raw: str) -> str:
    """Retorna o e-mail normalizado ou lança `invalid_email`."""
    email = normalize_email(raw)
    if len(email) > EMAIL_MAX_LENGTH or ".." in email or not _EMAIL_PATTERN.fullmatch(email):
        raise ValidationError("invalid_email")
    return email


def validate_password(password: str, email: str | None = None) -> None:
    """Política inspirada no NIST SP 800-63B: tamanho e bloqueio, sem regras de composição."""
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValidationError("password_too_short")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValidationError("password_too_long")
    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS or len(set(password)) < 4:
        raise ValidationError("password_too_common")
    if email and lowered in {email, email.split("@", 1)[0]}:
        raise ValidationError("password_too_common")
