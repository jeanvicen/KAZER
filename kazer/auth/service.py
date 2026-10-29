"""Regras de autenticação: registro, confirmação, login, sessão e recuperação.

Princípios aplicados:
- respostas idênticas para e-mails cadastrados ou não (sem enumeração de contas);
- tempo de resposta equalizado com uma verificação Argon2id descartável;
- limites por cliente e por conta contra tentativas automatizadas;
- tokens de alta entropia, de uso único, guardados apenas como hash;
- nenhum e-mail, senha, token ou IP em logs.
"""

import hashlib
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from kazer.auth import messages
from kazer.auth.store import AuthStore, TokenPurpose
from kazer.auth.tokens import hash_token, new_token
from kazer.auth.validation import ValidationError, validate_email, validate_password
from kazer.integrations.email import MailDeliveryError, MailMessage, MailSender
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimit, RateLimiter

logger = logging.getLogger("kazer.auth")

TOKEN_MAX_LENGTH = 128


@dataclass(frozen=True, slots=True)
class AuthPolicy:
    """Durações (segundos) e limites; ajustáveis sem tocar nas regras."""

    session_ttl: int = 14 * 24 * 3600
    verification_ttl: int = 24 * 3600
    reset_ttl: int = 30 * 60
    unverified_account_ttl: int = 7 * 24 * 3600
    login_per_client: RateLimit = field(default_factory=lambda: RateLimit(30, 600))
    login_failures_per_account: RateLimit = field(default_factory=lambda: RateLimit(5, 900))
    register_per_client: RateLimit = field(default_factory=lambda: RateLimit(10, 3600))
    mail_per_client: RateLimit = field(default_factory=lambda: RateLimit(10, 3600))
    mail_per_account: RateLimit = field(default_factory=lambda: RateLimit(3, 3600))
    token_per_client: RateLimit = field(default_factory=lambda: RateLimit(20, 600))


class AuthError(Exception):
    """Falha esperada com código estável; nunca inclui dados do usuário."""

    def __init__(self, code: str, status: int, retry_after: float = 0.0) -> None:
        """`retry_after` > 0 apenas para limites de taxa."""
        super().__init__(code)
        self.code = code
        self.status = status
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class SessionGrant:
    """Sessão recém-criada: o token em claro vai só para o cookie HttpOnly."""

    token: str
    email: str
    max_age: int


def _account_key(prefix: str, email: str) -> str:
    # Chaves de limite usam hash para não manter e-mails legíveis na memória.
    return f"{prefix}:{hashlib.sha256(email.encode('utf-8')).hexdigest()}"


class AuthService:
    """Serviço síncrono; a interface web o executa fora do loop de eventos."""

    def __init__(
        self,
        store: AuthStore,
        hashing: PasswordHashing,
        mailer: MailSender,
        limiter: RateLimiter,
        public_origin: str,
        policy: AuthPolicy | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        """Dependências injetadas para testes com dublês locais."""
        self._store = store
        self._hashing = hashing
        self._mailer = mailer
        self._limiter = limiter
        self._origin = public_origin.rstrip("/")
        self._policy = policy or AuthPolicy()
        self._clock = clock

    def _now(self) -> int:
        return int(self._clock())

    def _limit(self, key: str, limit: RateLimit) -> None:
        wait = self._limiter.hit(key, limit)
        if wait > 0:
            logger.info("auth.rate_limited", extra={"scope": key.split(":", 1)[0]})
            raise AuthError("rate_limited", 429, retry_after=wait)

    def _mail_quota_available(self, email: str) -> bool:
        # Excedido por endereço: silencia o envio sem mudar a resposta (anti mail-bombing).
        return self._limiter.hit(_account_key("mail", email), self._policy.mail_per_account) == 0

    @staticmethod
    def _valid_email(raw: str) -> str:
        try:
            return validate_email(raw)
        except ValidationError as exc:
            raise AuthError(exc.code, 422) from None

    @staticmethod
    def _check_token(token: str) -> str:
        if not token or len(token) > TOKEN_MAX_LENGTH:
            raise AuthError("invalid_token", 400)
        return hash_token(token)

    def initialize(self) -> None:
        """Prepara o banco e aplica a retenção pendente."""
        self._store.initialize()
        self.purge()

    def purge(self) -> None:
        """Remove sessões/links vencidos e contas não confirmadas antigas."""
        self._store.purge_expired(self._now(), self._policy.unverified_account_ttl)

    def deliver(self, message: MailMessage) -> None:
        """Entrega diferida (tarefa de fundo); falhas são registradas sem dados pessoais."""
        try:
            self._mailer.send(message)
        except MailDeliveryError:
            logger.warning("auth.mail_deferred_failed")

    def register(self, raw_email: str, password: str, client: str) -> None:
        """Cria conta não confirmada e envia o link; mesma resposta se o e-mail já existir."""
        self._limit(f"register:{client}", self._policy.register_per_client)
        email = self._valid_email(raw_email)
        try:
            validate_password(password, email)
        except ValidationError as exc:
            raise AuthError(exc.code, 422) from None

        now = self._now()
        account = self._store.find_user_by_email(email)
        if account is None:
            # Em corrida com outro registro do mesmo e-mail, segue como conta existente.
            created = self._store.create_user(email, self._hashing.hash(password), now)
            account = created or self._store.find_user_by_email(email)
        else:
            self._hashing.burn(password)

        if account is None or not self._mail_quota_available(email):
            return
        if account.verified:
            message = messages.existing_account_message(email, self._origin)
        else:
            message = self._issue_verification(account.id, email, now)
        try:
            self._mailer.send(message)
        except MailDeliveryError:
            raise AuthError("delivery_failed", 503) from None
        logger.info("auth.register.accepted")

    def _issue_verification(self, user_id: str, email: str, now: int) -> MailMessage:
        token = new_token()
        self._store.create_email_token(
            user_id,
            hash_token(token),
            TokenPurpose.VERIFY_EMAIL,
            now,
            now + self._policy.verification_ttl,
        )
        return messages.verification_message(email, self._origin, token)

    def resend_verification(self, raw_email: str, client: str) -> MailMessage | None:
        """Reemite o link se houver conta pendente; resposta independe disso."""
        self._limit(f"mail:{client}", self._policy.mail_per_client)
        email = self._valid_email(raw_email)
        user = self._store.find_user_by_email(email)
        if user is None or user.verified or not self._mail_quota_available(email):
            return None
        return self._issue_verification(user.id, email, self._now())

    def verify_email(self, token: str, client: str) -> None:
        """Confirma o e-mail a partir do link recebido."""
        self._limit(f"token:{client}", self._policy.token_per_client)
        if not self._store.verify_email_with_token(self._check_token(token), self._now()):
            raise AuthError("invalid_token", 400)
        logger.info("auth.email_verified")

    def login(self, raw_email: str, password: str, client: str) -> SessionGrant:
        """Valida credenciais; erros não distinguem e-mail inexistente de senha errada."""
        self._limit(f"login:{client}", self._policy.login_per_client)
        try:
            email = validate_email(raw_email)
        except ValidationError:
            self._hashing.burn(password)
            raise AuthError("invalid_credentials", 401) from None

        account_key = _account_key("login-fail", email)
        wait = self._limiter.retry_after(account_key, self._policy.login_failures_per_account)
        if wait > 0:
            raise AuthError("rate_limited", 429, retry_after=wait)

        user = self._store.find_user_by_email(email)
        if user is None:
            self._hashing.burn(password)
            valid = False
        else:
            valid = len(password) <= 1024 and self._hashing.verify(user.password_hash, password)
        if user is None or not valid:
            self._limiter.hit(account_key, self._policy.login_failures_per_account)
            logger.info("auth.login.failed")
            raise AuthError("invalid_credentials", 401)
        if not user.verified:
            raise AuthError("email_not_verified", 403)

        self._limiter.reset(account_key)
        if self._hashing.needs_rehash(user.password_hash):
            self._store.update_password_hash(user.id, self._hashing.hash(password))

        now = self._now()
        token = new_token()
        self._store.create_session(user.id, hash_token(token), now, now + self._policy.session_ttl)
        self.purge()
        logger.info("auth.login.succeeded")
        return SessionGrant(token=token, email=user.email, max_age=self._policy.session_ttl)

    def session_email(self, token: str | None) -> str | None:
        """Retorna o e-mail da sessão válida ou None."""
        if not token or len(token) > TOKEN_MAX_LENGTH:
            return None
        user = self._store.find_session_user(hash_token(token), self._now())
        return None if user is None else user.email

    def logout(self, token: str | None) -> None:
        """Encerra a sessão no servidor; o cookie é apagado pela interface."""
        if token and len(token) <= TOKEN_MAX_LENGTH:
            self._store.delete_session(hash_token(token))

    def request_password_reset(self, raw_email: str, client: str) -> MailMessage | None:
        """Gera link de redefinição se a conta existir; resposta é sempre a mesma."""
        self._limit(f"mail:{client}", self._policy.mail_per_client)
        email = self._valid_email(raw_email)
        user = self._store.find_user_by_email(email)
        if user is None or not self._mail_quota_available(email):
            return None
        token = new_token()
        now = self._now()
        self._store.create_email_token(
            user.id,
            hash_token(token),
            TokenPurpose.RESET_PASSWORD,
            now,
            now + self._policy.reset_ttl,
        )
        return messages.password_reset_message(email, self._origin, token)

    def reset_password(self, token: str, password: str, client: str) -> None:
        """Define nova senha com link válido e encerra todas as sessões da conta."""
        self._limit(f"token:{client}", self._policy.token_per_client)
        token_hash = self._check_token(token)
        now = self._now()
        user = self._store.find_email_token_user(token_hash, TokenPurpose.RESET_PASSWORD, now)
        if user is None:
            raise AuthError("invalid_token", 400)
        try:
            validate_password(password, user.email)
        except ValidationError as exc:
            raise AuthError(exc.code, 422) from None
        if not self._store.reset_password_with_token(token_hash, self._hashing.hash(password), now):
            raise AuthError("invalid_token", 400)
        self._limiter.reset(_account_key("login-fail", user.email))
        logger.info("auth.password_reset")
