"""Testes do serviço de autenticação com dublês locais (sem rede, sem SMTP)."""

import re
from pathlib import Path

import pytest
from argon2 import PasswordHasher

from kazer.auth.service import AuthError, AuthPolicy, AuthService
from kazer.auth.store import AuthStore
from kazer.auth.validation import ValidationError, validate_email, validate_password
from kazer.integrations.email import MailDeliveryError, MailMessage
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimit, RateLimiter

PASSWORD = "correct horse battery"


class Outbox:
    """Caixa de saída em memória que pode simular falha de entrega."""

    def __init__(self) -> None:
        self.messages: list[MailMessage] = []
        self.fail = False

    def send(self, message: MailMessage) -> None:
        if self.fail:
            raise MailDeliveryError("falha simulada")
        self.messages.append(message)

    def token(self, kind: str) -> str:
        match = re.search(rf"#{kind}=([\w-]+)", self.messages[-1].body)
        assert match, "link não encontrado"
        return match.group(1)


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def fast_hashing() -> PasswordHashing:
    # Parâmetros reduzidos apenas para acelerar testes; produção usa o padrão RFC 9106.
    return PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))


@pytest.fixture
def env(tmp_path: Path, fast_hashing: PasswordHashing) -> tuple[AuthService, Outbox, Clock]:
    outbox, clock = Outbox(), Clock()
    service = AuthService(
        AuthStore(tmp_path / "auth.db"),
        fast_hashing,
        outbox,
        RateLimiter(clock=clock),
        "https://kazer.test",
        clock=clock,
    )
    service.initialize()
    return service, outbox, clock


def _register_and_verify(
    service: AuthService, outbox: Outbox, email: str = "Ana@Example.com"
) -> None:
    service.register(email, PASSWORD, "c1")
    service.verify_email(outbox.token("verify"), "c1")


def test_validation_rules() -> None:
    assert validate_email("  Ana@Example.COM ") == "ana@example.com"
    for bad in ("ana", "ana@x", "a b@x.com", "a@b..com", "<a>@b.com"):
        with pytest.raises(ValidationError):
            validate_email(bad)
    for bad, code in (
        ("short", "password_too_short"),
        ("x" * 129, "password_too_long"),
        ("qwertyuiop", "password_too_common"),
        ("aaaaaaaaaaaa", "password_too_common"),
    ):
        with pytest.raises(ValidationError) as info:
            validate_password(bad)
        assert info.value.code == code


def test_register_requires_verification_before_login(
    env: tuple[AuthService, Outbox, Clock],
) -> None:
    service, outbox, _ = env
    service.register("Ana@Example.com", PASSWORD, "c1")
    assert outbox.messages[-1].to == "ana@example.com"
    assert "https://kazer.test/#verify=" in outbox.messages[-1].body
    with pytest.raises(AuthError) as info:
        service.login("ana@example.com", PASSWORD, "c1")
    assert info.value.code == "email_not_verified"

    service.verify_email(outbox.token("verify"), "c1")
    grant = service.login("ANA@example.com", PASSWORD, "c1")
    assert grant.email == "ana@example.com"
    assert service.session_email(grant.token) == "ana@example.com"


def test_verification_link_is_single_use(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, _ = env
    service.register("ana@example.com", PASSWORD, "c1")
    token = outbox.token("verify")
    service.verify_email(token, "c1")
    with pytest.raises(AuthError) as info:
        service.verify_email(token, "c1")
    assert info.value.code == "invalid_token"


def test_registration_does_not_reveal_existing_accounts(
    env: tuple[AuthService, Outbox, Clock],
) -> None:
    service, outbox, _ = env
    _register_and_verify(service, outbox)
    service.register("ana@example.com", "another strong secret", "c2")  # mesma resposta, sem erro
    assert outbox.messages[-1].subject == "Sua conta KAZER"
    assert "#verify=" not in outbox.messages[-1].body
    # A senha original continua valendo.
    assert service.login("ana@example.com", PASSWORD, "c2").email == "ana@example.com"


def test_login_errors_are_generic(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, _ = env
    _register_and_verify(service, outbox)
    for email, password in (
        ("ana@example.com", "wrong password!"),
        ("nobody@example.com", PASSWORD),
    ):
        with pytest.raises(AuthError) as info:
            service.login(email, password, "c1")
        assert (info.value.code, info.value.status) == ("invalid_credentials", 401)


def test_account_lockout_after_repeated_failures(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, clock = env
    _register_and_verify(service, outbox)
    for _ in range(5):
        with pytest.raises(AuthError):
            service.login("ana@example.com", "wrong password!", "c1")
    with pytest.raises(AuthError) as info:
        service.login("ana@example.com", PASSWORD, "c9")  # bloqueio por conta, não por IP
    assert info.value.code == "rate_limited" and info.value.retry_after > 0
    clock.now += 901
    assert service.login("ana@example.com", PASSWORD, "c9").email == "ana@example.com"


def test_logout_and_session_expiry(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, clock = env
    _register_and_verify(service, outbox)
    first = service.login("ana@example.com", PASSWORD, "c1")
    service.logout(first.token)
    assert service.session_email(first.token) is None

    second = service.login("ana@example.com", PASSWORD, "c1")
    clock.now += AuthPolicy().session_ttl + 1
    assert service.session_email(second.token) is None
    assert service.session_email("forged") is None


def test_password_reset_flow_revokes_sessions(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, _ = env
    _register_and_verify(service, outbox)
    session = service.login("ana@example.com", PASSWORD, "c1")

    assert service.request_password_reset("nobody@example.com", "c1") is None
    message = service.request_password_reset("ana@example.com", "c1")
    assert message is not None
    service.deliver(message)
    token = outbox.token("reset")

    with pytest.raises(AuthError) as weak:
        service.reset_password(token, "short", "c1")
    assert weak.value.code == "password_too_short"  # link não é gasto por senha inválida

    service.reset_password(token, "a brand new passphrase", "c1")
    assert service.session_email(session.token) is None
    with pytest.raises(AuthError):
        service.login("ana@example.com", PASSWORD, "c1")
    assert service.login("ana@example.com", "a brand new passphrase", "c1")
    with pytest.raises(AuthError) as reused:
        service.reset_password(token, "yet another passphrase", "c1")
    assert reused.value.code == "invalid_token"


def test_reset_link_expires(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, clock = env
    _register_and_verify(service, outbox)
    message = service.request_password_reset("ana@example.com", "c1")
    assert message is not None
    service.deliver(message)
    clock.now += AuthPolicy().reset_ttl + 1
    with pytest.raises(AuthError) as info:
        service.reset_password(outbox.token("reset"), "a brand new passphrase", "c1")
    assert info.value.code == "invalid_token"


def test_delivery_failure_is_reported(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, _ = env
    outbox.fail = True
    with pytest.raises(AuthError) as info:
        service.register("ana@example.com", PASSWORD, "c1")
    assert (info.value.code, info.value.status) == ("delivery_failed", 503)


def test_client_rate_limit_on_registration(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, _, _ = env
    for index in range(10):
        service.register(f"user{index}@example.com", PASSWORD, "bot")
    with pytest.raises(AuthError) as info:
        service.register("user99@example.com", PASSWORD, "bot")
    assert info.value.code == "rate_limited"


def test_unverified_accounts_are_purged(env: tuple[AuthService, Outbox, Clock]) -> None:
    service, outbox, clock = env
    service.register("ana@example.com", PASSWORD, "c1")
    clock.now += AuthPolicy().unverified_account_ttl + 1
    service.purge()
    with pytest.raises(AuthError) as info:
        service.verify_email(outbox.token("verify"), "c1")
    assert info.value.code == "invalid_token"


def test_account_deletion_cascades(tmp_path: Path, fast_hashing: PasswordHashing) -> None:
    store = AuthStore(tmp_path / "auth.db")
    store.initialize()
    user = store.create_user("ana@example.com", fast_hashing.hash(PASSWORD), 1)
    assert user is not None
    store.create_session(user.id, "h", 1, 10**10)
    store.delete_user(user.id)
    assert store.find_session_user("h", 2) is None
    assert store.find_user_by_email("ana@example.com") is None


def test_rate_limiter_window() -> None:
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    limit = RateLimit(2, 60)
    assert limiter.hit("k", limit) == 0 and limiter.hit("k", limit) == 0
    assert limiter.hit("k", limit) > 0
    clock.now += 60
    assert limiter.hit("k", limit) == 0
