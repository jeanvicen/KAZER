"""Testes da API HTTP de autenticação e das defesas de borda."""

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from starlette.testclient import TestClient

from kazer.auth.service import AuthService
from kazer.auth.store import AuthStore
from kazer.config.settings import Settings, load_settings
from kazer.integrations.email import MailMessage
from kazer.interfaces.web.app import create_app
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter

ORIGIN = "http://testserver"
PASSWORD = "correct horse battery"


class Outbox:
    def __init__(self) -> None:
        self.messages: list[MailMessage] = []

    def send(self, message: MailMessage) -> None:
        self.messages.append(message)

    def token(self, kind: str) -> str:
        match = re.search(rf"#{kind}=([\w-]+)", self.messages[-1].body)
        assert match
        return match.group(1)


@pytest.fixture
def outbox() -> Outbox:
    return Outbox()


@pytest.fixture
def client(tmp_path: Path, outbox: Outbox) -> Iterator[TestClient]:
    settings = Settings(
        environment="test", public_url=ORIGIN, database_path=tmp_path / "a.db", cookie_secure=False
    )
    service = AuthService(
        AuthStore(settings.database_path),
        PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
        outbox,
        RateLimiter(),
        settings.public_origin,
    )
    with TestClient(create_app(settings, service), headers={"Origin": ORIGIN}) as test_client:
        yield test_client


def test_index_has_strict_headers(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script-src 'self'" in csp
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-frame-options"] == "DENY"
    body = response.text.lower()
    social = ("google", "facebook", "appleid", "twitter", "github", "oauth", "continuar com")
    trackers = ("analytics", "gtag", "pixel", "segment")
    for marker in social + trackers:
        assert marker not in body
    assert "http://" not in body and "https://" not in body  # nenhum recurso externo
    assert 'id="open-signup"' in body and 'id="open-signin"' in body


def test_legal_pages_and_manifest(client: TestClient) -> None:
    for path, title in (("/termos", "Termos de Uso"), ("/privacidade", "Política de Privacidade")):
        page = client.get(path)
        assert page.status_code == 200
        assert title in page.text
        assert "content-security-policy" in page.headers
        assert "http://" not in page.text and "https://" not in page.text
    manifest = client.get("/manifest.webmanifest")
    assert manifest.headers["content-type"].startswith("application/manifest+json")
    assert manifest.json()["display"] == "standalone"
    home = client.get("/")
    assert 'href="/termos"' in home.text and 'href="/privacidade"' in home.text
    assert "manifest-src 'self'" in home.headers["content-security-policy"]


def test_full_flow_over_http(client: TestClient, outbox: Outbox) -> None:
    assert client.get("/api/auth/session").json() == {"authenticated": False}

    response = client.post(
        "/api/auth/register", json={"email": "ana@example.com", "password": PASSWORD}
    )
    assert response.status_code == 202
    assert response.headers["cache-control"] == "no-store"

    response = client.post(
        "/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
    )
    assert (response.status_code, response.json()) == (403, {"error": "email_not_verified"})

    response = client.post("/api/auth/verify-email", json={"token": outbox.token("verify")})
    # Confirmar pelo link já abre a sessão: a pessoa entra direto no chat.
    assert response.json() == {
        "status": "verified",
        "authenticated": True,
        "email": "ana@example.com",
    }
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/session").json()["authenticated"] is True
    client.post("/api/auth/logout")

    response = client.post(
        "/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert PASSWORD not in response.text
    assert client.get("/api/auth/session").json() == {
        "authenticated": True,
        "email": "ana@example.com",
    }

    assert client.post("/api/auth/logout").json() == {"authenticated": False}
    assert client.get("/api/auth/session").json() == {"authenticated": False}


def test_reset_request_is_uniform(client: TestClient, outbox: Outbox) -> None:
    unknown = client.post("/api/auth/password-reset", json={"email": "nobody@example.com"})
    client.post("/api/auth/register", json={"email": "ana@example.com", "password": PASSWORD})
    known = client.post("/api/auth/password-reset", json={"email": "ana@example.com"})
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert "#reset=" in outbox.messages[-1].body  # entregue em tarefa de fundo

    response = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": outbox.token("reset"), "password": "a brand new passphrase"},
    )
    assert response.json() == {"status": "password_updated"}


def test_cross_origin_and_non_json_requests_are_rejected(client: TestClient) -> None:
    payload = {"email": "ana@example.com", "password": PASSWORD}
    evil = client.post("/api/auth/login", json=payload, headers={"Origin": "https://evil.example"})
    assert (evil.status_code, evil.json()) == (403, {"error": "forbidden_origin"})
    cross_site = client.post(
        "/api/auth/login", json=payload, headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert cross_site.status_code == 403
    form = client.post("/api/auth/login", data=payload)
    assert form.status_code == 415
    huge = client.post("/api/auth/login", json={"email": "a" * 5000, "password": "x"})
    assert huge.status_code == 413


def test_login_rate_limit_returns_retry_after(client: TestClient, outbox: Outbox) -> None:
    client.post("/api/auth/register", json={"email": "ana@example.com", "password": PASSWORD})
    client.post("/api/auth/verify-email", json={"token": outbox.token("verify")})
    for _ in range(5):
        client.post(
            "/api/auth/login", json={"email": "ana@example.com", "password": "nope nope nope"}
        )
    response = client.post(
        "/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
    )
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_production_settings_fail_closed() -> None:
    settings = Settings(
        environment="production", public_url="http://kazer.example", mail_backend="file"
    )
    assert len(settings.auth_blockers) >= 3


def test_serverless_without_persistent_storage_keeps_accounts_closed() -> None:
    settings = load_settings({"VERCEL": "1"})
    assert settings.serverless and settings.cookie_secure
    assert settings.auth_blockers
    with TestClient(create_app(settings), headers={"Origin": "https://testserver"}) as client:
        page = client.get("/")
        assert page.status_code == 200 and "KAZER" in page.text
        assert client.get("/assets/app.js").status_code == 200
        assert "strict-transport-security" in page.headers
        assert client.get("/api/auth/session").json() == {
            "authenticated": False,
            "available": False,
        }
        for path in ("/api/auth/login", "/api/auth/register", "/api/auth/password-reset"):
            response = client.post(path, json={"email": "ana@example.com", "password": PASSWORD})
            assert (response.status_code, response.json()) == (503, {"error": "auth_unavailable"})
