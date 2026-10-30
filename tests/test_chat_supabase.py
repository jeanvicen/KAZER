"""Chat com contas do Supabase Auth (cliente HTTP simulado, sem rede).

Garante que a identidade vem só do Supabase, que contas diferentes não se
enxergam, que o access token vencido é renovado sem deslogar e que o link de
confirmação já abre a sessão.
"""

import json
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from starlette.testclient import TestClient

from kazer.auth.supabase_service import SupabaseAuthService, SupabaseSession
from kazer.brain.model_provider import CancelToken, Capabilities, GenerationRequest, StreamEvent
from kazer.chat.service import ChatService
from kazer.chat.store import ChatStore
from kazer.chat.supabase_store import SupabaseChatStore
from kazer.chat.uploads import UploadStorage
from kazer.config.settings import Settings
from kazer.interfaces.web.app import _build_chat, create_app
from kazer.security.rate_limiter import RateLimiter

ORIGIN = "http://testserver"
COOKIE = "kazer_session"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class Echo:
    capabilities = Capabilities(images=True)

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        yield StreamEvent("text", "ok")
        yield StreamEvent("stop", "end")


class FakeSupabase:
    """Simula /auth/v1: contas, tokens que vencem e refresh com rotação."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.access: dict[str, str] = {}  # access token -> user id
        self.refresh: dict[str, str] = {}  # refresh token -> user id
        self.expired: set[str] = set()

    def add_user(self, email: str, password: str) -> None:
        user_id = str(uuid.uuid4())
        self.users[email] = {
            "id": user_id,
            "email": email,
            "password": password,
            "created_at": "2026-10-29T12:00:00Z",
            "email_confirmed_at": "2026-10-29T12:05:00Z",
        }

    def _issue(self, user: dict[str, Any]) -> dict[str, Any]:
        access, refresh = f"at-{uuid.uuid4().hex}", f"rt-{uuid.uuid4().hex}"
        self.access[access] = user["id"]
        self.refresh[refresh] = user["id"]
        public = {key: value for key, value in user.items() if key != "password"}
        return {
            "access_token": access,
            "refresh_token": refresh,
            "expires_in": 3600,
            "user": public,
        }

    def _by_id(self, user_id: str) -> dict[str, Any]:
        return next(user for user in self.users.values() if user["id"] == user_id)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        request = httpx.Request(method, url)
        path = url.split("/auth/v1", 1)[1]
        token = kwargs.get("headers", {}).get("Authorization", "").removeprefix("Bearer ")
        body: dict[str, str] = kwargs.get("json") or {}
        if path == "/token?grant_type=password":
            user = self.users.get(body.get("email", ""))
            if user is None or user["password"] != body.get("password"):
                return httpx.Response(
                    400, json={"error_description": "Invalid login"}, request=request
                )
            return httpx.Response(200, json=self._issue(user), request=request)
        if path == "/token?grant_type=refresh_token":
            user_id = self.refresh.pop(body.get("refresh_token", ""), None)
            if user_id is None:
                return httpx.Response(400, json={}, request=request)
            return httpx.Response(200, json=self._issue(self._by_id(user_id)), request=request)
        if path == "/user" and method == "GET":
            if token in self.expired or token not in self.access:
                return httpx.Response(401, json={"msg": "expired"}, request=request)
            user = self._by_id(self.access[token])
            public = {key: value for key, value in user.items() if key != "password"}
            return httpx.Response(200, json=public, request=request)
        if path.startswith("/logout"):
            return httpx.Response(204, request=request)
        return httpx.Response(404, json={}, request=request)


@pytest.fixture
def env(tmp_path: Path) -> Iterator[tuple[TestClient, TestClient, FakeSupabase]]:
    fake = FakeSupabase()
    fake.add_user("ana@example.com", "correct horse battery")
    fake.add_user("bia@example.com", "outra senha bem longa")
    auth = SupabaseAuthService(
        "https://example.supabase.co",
        "sb_publishable_test",
        ORIGIN,
        RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        cookie_secure=False,
        database_path=tmp_path / "k.db",
        upload_dir=tmp_path / "up",
    )
    chat = ChatService(
        ChatStore(settings.database_path), UploadStorage(settings.upload_dir), Echo()
    )
    app = create_app(settings, auth, chat=chat)
    with (
        TestClient(app, headers={"Origin": ORIGIN}) as ana,
        TestClient(app, headers={"Origin": ORIGIN}) as bia,
    ):
        for client, email, password in (
            (ana, "ana@example.com", "correct horse battery"),
            (bia, "bia@example.com", "outra senha bem longa"),
        ):
            response = client.post("/api/auth/login", json={"email": email, "password": password})
            assert response.status_code == 200
        yield ana, bia, fake


def send(client: TestClient, content: str, **extra: Any) -> list[dict[str, Any]]:
    body = {"content": content, "client_id": uuid.uuid4().hex, **extra}
    response = client.post("/api/chat", json=body)
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_chat_runs_on_supabase_accounts_and_isolates_them(
    env: tuple[TestClient, TestClient, FakeSupabase],
) -> None:
    ana, bia, _ = env
    stream = send(ana, "Segredo da Ana")
    assert stream[-1]["reply"]["status"] == "complete"
    conversation_id = stream[0]["conversation"]["id"]
    upload = ana.post("/api/attachments", content=PNG, headers={"Content-Type": "image/png"})
    assert upload.status_code == 201  # dono com id UUID do Supabase

    assert bia.get("/api/conversations").json()["items"] == []
    assert bia.get(f"/api/conversations/{conversation_id}").status_code == 404
    settings = ana.get("/api/settings").json()
    assert settings["account"]["email"] == "ana@example.com"
    assert settings["account"]["verified_at"] is not None


def test_expired_access_token_is_renewed_without_logging_out(
    env: tuple[TestClient, TestClient, FakeSupabase],
) -> None:
    ana, _, fake = env
    decoded = SupabaseSession.decode(ana.cookies.get(COOKIE) or "")
    assert decoded is not None
    fake.expired.add(decoded[0])
    response = ana.get("/api/conversations")
    assert response.status_code == 200
    assert COOKIE in response.headers.get("set-cookie", "")
    renewed = SupabaseSession.decode(ana.cookies.get(COOKIE) or "")
    assert renewed is not None and renewed[0] != decoded[0]
    assert ana.get("/api/auth/session").json()["authenticated"] is True


def test_verification_link_opens_the_session(
    env: tuple[TestClient, TestClient, FakeSupabase],
) -> None:
    _, _, fake = env
    tokens = fake._issue(fake.users["ana@example.com"])
    app_client = TestClient(env[0].app, headers={"Origin": ORIGIN})
    response = app_client.post(
        "/api/auth/verify-email",
        json={"token": tokens["access_token"], "refresh_token": tokens["refresh_token"]},
    )
    assert response.json() == {
        "status": "verified",
        "authenticated": True,
        "email": "ana@example.com",
    }
    assert app_client.get("/api/auth/session").json()["authenticated"] is True
    # Sem o refresh token, só confirma (a pessoa entra pelo login).
    only = app_client.post("/api/auth/verify-email", json={"token": tokens["access_token"]})
    assert only.json() == {"status": "verified"}


def test_account_deletion_needs_the_service_key(
    env: tuple[TestClient, TestClient, FakeSupabase],
) -> None:
    ana, _, _ = env
    response = ana.post("/api/account/delete", json={"password": "correct horse battery"})
    assert (response.status_code, response.json()["error"]) == (503, "account_delete_unavailable")
    wrong = ana.post("/api/account/delete", json={"password": "errada"})
    assert wrong.json()["error"] == "invalid_password"


def test_serverless_with_supabase_opens_the_chat() -> None:
    """Com o Supabase configurado, as conversas vão para o Postgres e o chat abre
    mesmo em função serverless (o disco efêmero deixa de ser o problema)."""
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        cookie_secure=False,
        serverless=True,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )
    chat = _build_chat(settings, None)
    assert type(chat._store).__name__ == "SupabaseChatStore"
    assert type(chat._uploads).__name__ == "SupabaseUploadStorage"
    # Sem Supabase, o mesmo builder cai no SQLite local.
    local = _build_chat(Settings(environment="test", public_url=ORIGIN), None)
    assert type(local._store).__name__ == "ChatStore"


def test_chat_without_supabase_stays_closed_on_serverless() -> None:
    """Sem Supabase, o SQLite não sobrevive à função: o chat fica fechado."""
    settings = Settings(environment="test", public_url=ORIGIN, cookie_secure=False, serverless=True)
    fake = FakeSupabase()
    fake.add_user("ana@example.com", "correct horse battery")
    auth = SupabaseAuthService(
        "https://example.supabase.co", "sb_publishable_test", ORIGIN, RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
    with TestClient(create_app(settings, auth), headers={"Origin": ORIGIN}) as client:
        client.post(
            "/api/auth/login",
            json={"email": "ana@example.com", "password": "correct horse battery"},
        )
        response = client.get("/api/settings")
        assert (response.status_code, response.json()) == (503, {"error": "chat_unavailable"})


def test_unreachable_chat_database_is_reported_honestly() -> None:
    """Postgres fora do ar não derruba o servidor: vira `chat_unavailable`."""
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        cookie_secure=False,
        supabase_url="https://offline.invalid",
        supabase_publishable_key="sb_publishable_test",
    )
    fake = FakeSupabase()
    fake.add_user("ana@example.com", "correct horse battery")
    auth = SupabaseAuthService(
        settings.supabase_url, settings.supabase_publishable_key, ORIGIN, RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
    broken = SupabaseChatStore(
        settings.supabase_url,
        settings.supabase_publishable_key,
        client=Unreachable(),  # type: ignore[arg-type]
    )
    chat = ChatService(broken, UploadStorage(Path("/nonexistent")), Echo())
    with TestClient(create_app(settings, auth, chat=chat), headers={"Origin": ORIGIN}) as client:
        client.post(
            "/api/auth/login",
            json={"email": "ana@example.com", "password": "correct horse battery"},
        )
        response = client.get("/api/conversations")
        assert (response.status_code, response.json()) == (503, {"error": "chat_unavailable"})


def test_database_without_migrations_says_so() -> None:
    """Banco no ar, funções do KAZER ausentes (404): a tela diz que faltam as migrações."""
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        cookie_secure=False,
        supabase_url="https://sem-migracao.invalid",
        supabase_publishable_key="sb_publishable_test",
    )
    fake = FakeSupabase()
    fake.add_user("ana@example.com", "correct horse battery")
    auth = SupabaseAuthService(
        settings.supabase_url, settings.supabase_publishable_key, ORIGIN, RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
    store = SupabaseChatStore(
        settings.supabase_url,
        settings.supabase_publishable_key,
        client=NoFunctions(),  # type: ignore[arg-type]
    )
    chat = ChatService(store, UploadStorage(Path("/nonexistent")), Echo())
    with TestClient(create_app(settings, auth, chat=chat), headers={"Origin": ORIGIN}) as client:
        client.post(
            "/api/auth/login",
            json={"email": "ana@example.com", "password": "correct horse battery"},
        )
        body = client.get("/api/conversations").json()
        assert body == {"error": "chat_unavailable", "reason": "not_migrated"}


class NoFunctions:
    """PostgREST sem as funções do KAZER: 404 com o código PGRST202."""

    def post(self, url: str, *args: Any, **kwargs: Any) -> httpx.Response:
        return httpx.Response(
            404,
            json={"code": "PGRST202", "message": "Could not find the function"},
            request=httpx.Request("POST", url),
        )


class Unreachable:
    """Cliente HTTP que nunca conecta."""

    def post(self, *args: Any, **kwargs: Any) -> httpx.Response:
        raise httpx.ConnectError("sem rota")

    def request(self, *args: Any, **kwargs: Any) -> httpx.Response:
        raise httpx.ConnectError("sem rota")


def _auth_for(settings: Settings) -> SupabaseAuthService:
    fake = FakeSupabase()
    return SupabaseAuthService(
        settings.supabase_url, settings.supabase_publishable_key, ORIGIN, RateLimiter(),
        client=fake,  # type: ignore[arg-type]
    )
