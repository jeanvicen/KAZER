"""Testes simulados do adaptador Supabase Auth para recuperação de senha."""
import base64
import json
from typing import Any

import httpx
from starlette.testclient import TestClient

from kazer.auth.supabase_service import SupabaseAuthService
from kazer.config.settings import Settings
from kazer.interfaces.web.app import create_app
from kazer.security.rate_limiter import RateLimiter


def recovery_token(email: str) -> str:
    def part(value: dict[str, Any]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part({'type': 'recovery', 'email': email})}.signature"


class FakeSupabaseClient:
    def __init__(self, email: str) -> None:
        self.email = email
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        self.calls.append((method, url, kwargs))
        request = httpx.Request(method, url)
        if method == "GET" and url.endswith("/user"):
            return httpx.Response(200, json={"email": self.email}, request=request)
        if method == "PUT" and url.endswith("/user"):
            assert kwargs["json"] == {"password": "A new secure passphrase 2026!"}
            return httpx.Response(200, json={"email": self.email}, request=request)
        return httpx.Response(500, request=request)


def test_simulated_recovery_token_updates_password() -> None:
    email = "recovery@example.com"
    fake = FakeSupabaseClient(email)
    service = SupabaseAuthService(
        "https://example.supabase.co",
        "sb_publishable_test",
        "http://localhost:8000",
        RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )

    service.reset_password(recovery_token(email), "A new secure passphrase 2026!", "test-client")

    assert [call[0:2] for call in fake.calls] == [
        ("GET", "https://example.supabase.co/auth/v1/user"),
        ("PUT", "https://example.supabase.co/auth/v1/user"),
    ]


def test_simulated_recovery_route_returns_success() -> None:
    email = "recovery@example.com"
    fake = FakeSupabaseClient(email)
    service = SupabaseAuthService(
        "https://example.supabase.co",
        "sb_publishable_test",
        "http://testserver",
        RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
    settings = Settings(
        environment="test",
        public_url="http://testserver",
        cookie_secure=False,
    )

    with TestClient(create_app(settings, service), headers={"Origin": "http://testserver"}) as client:
        response = client.post(
            "/api/auth/password-reset/confirm",
            json={"token": recovery_token(email), "password": "A new secure passphrase 2026!"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "password_updated"}
    assert 'kazer_session=""' in response.headers["set-cookie"]
