"""Testes do chat pela API HTTP: posse, idempotência, cotas, anexos e conta.

O provedor é um dublê local (sem rede); nenhuma resposta dele chega ao produto.
"""

import json
import re
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from argon2 import PasswordHasher
from starlette.testclient import TestClient

from kazer.auth.service import AuthService
from kazer.auth.store import AuthStore
from kazer.brain.model_provider import (
    CancelToken,
    Capabilities,
    GenerationRequest,
    ProviderError,
    StreamEvent,
)
from kazer.chat.service import ChatService
from kazer.chat.store import ChatStore
from kazer.chat.uploads import UploadStorage
from kazer.config.settings import Settings
from kazer.integrations.email import MailMessage
from kazer.interfaces.web.app import create_app
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter

ORIGIN = "http://testserver"
PASSWORD = "correct horse battery"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class Outbox:
    def __init__(self) -> None:
        self.messages: list[MailMessage] = []

    def send(self, message: MailMessage) -> None:
        self.messages.append(message)

    def token(self) -> str:
        match = re.search(r"#verify=([\w-]+)", self.messages[-1].body)
        assert match
        return match.group(1)


class FakeProvider:
    """Dublê do adaptador: registra os pedidos e devolve partes fixas."""

    def __init__(
        self,
        chunks: tuple[str, ...] = ("Olá", ", tudo certo?"),
        capabilities: Capabilities | None = None,
        error: str | None = None,
        hold: threading.Event | None = None,
    ) -> None:
        self.chunks = chunks
        self.capabilities = capabilities or Capabilities(images=True)
        self.error = error
        self.hold = hold
        self.requests: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        self.requests.append(request)
        if self.error:
            raise ProviderError(self.error)
        for chunk in self.chunks:
            yield StreamEvent("text", chunk)
        if self.hold is not None:
            while not cancel.cancelled() and not self.hold.wait(0.01):
                pass
        yield StreamEvent("stop", "end")


class Env:
    def __init__(self, tmp_path: Path, provider: FakeProvider | None, hourly: int = 60) -> None:
        self.outbox = Outbox()
        self.settings = Settings(
            environment="test",
            public_url=ORIGIN,
            database_path=tmp_path / "k.db",
            upload_dir=tmp_path / "uploads",
            cookie_secure=False,
        )
        self.auth = AuthService(
            AuthStore(self.settings.database_path),
            PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
            self.outbox,
            RateLimiter(),
            self.settings.public_origin,
        )
        self.chat = ChatService(
            ChatStore(self.settings.database_path),
            UploadStorage(self.settings.upload_dir),
            provider,
            hourly_units=hourly,
        )
        self.app = create_app(self.settings, self.auth, chat=self.chat)

    def client(self) -> TestClient:
        return TestClient(self.app, headers={"Origin": ORIGIN})

    def signed_in(self, client: TestClient, email: str) -> TestClient:
        client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
        response = client.post("/api/auth/verify-email", json={"token": self.outbox.token()})
        assert response.json()["authenticated"] is True
        return client


def events(response: Any) -> list[dict[str, Any]]:
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line]


def send(client: TestClient, content: str = "Oi", **extra: Any) -> list[dict[str, Any]]:
    body = {"content": content, "client_id": extra.pop("client_id", f"c-{time.time_ns()}")}
    body.update(extra)
    response = client.post("/api/chat", json=body)
    assert response.status_code == 200, response.text
    return events(response)


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


def test_chat_requires_a_session(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        for method, path in (
            ("GET", "/api/chat/config"),
            ("GET", "/api/conversations"),
            ("POST", "/api/chat"),
            ("GET", "/api/settings"),
            ("POST", "/api/attachments"),
        ):
            response = client.request(method, path, json={} if method == "POST" else None)
            assert (response.status_code, response.json()) == (401, {"error": "unauthenticated"})
        assert client.get("/c/abcdefghijklmnop").status_code == 200  # a página; a API decide


def test_send_streams_and_persists(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        config = client.get("/api/chat/config").json()
        assert config["available"] is True
        assert config["models"] == [{"id": "kaz-1.1", "label": "KAZ 1.1"}]
        assert config["efforts"] == [{"id": "baixo", "label": "Baixo"}]
        assert config["features"]["deep"] is False and config["features"]["research"] is False
        assert "anthropic" not in json.dumps(config).lower()

        stream = send(client, "Quero criar um app de receitas", timezone="America/Sao_Paulo")
        assert [event["type"] for event in stream] == ["start", "delta", "delta", "done"]
        start, done = stream[0], stream[-1]
        assert start["conversation"]["title"] == "Quero criar um app de receitas"
        assert done["reply"]["status"] == "complete"
        assert done["reply"]["content"] == "Olá, tudo certo?"

        conversation_id = start["conversation"]["id"]
        page = client.get("/api/conversations").json()
        assert [item["id"] for item in page["items"]] == [conversation_id]
        loaded = client.get(f"/api/conversations/{conversation_id}").json()
        roles = [(m["role"], m["status"]) for m in loaded["messages"]["items"]]
        assert roles == [("user", "complete"), ("assistant", "complete")]

        # Segunda mensagem leva o histórico completo ao modelo.
        send(client, "E o nome?", conversation_id=conversation_id)
        last = provider.requests[-1]
        assert [turn.role for turn in last.turns] == ["user", "assistant", "user"]
        assert "KAZER" in last.system and "America/Sao_Paulo" in last.system


def test_no_provider_is_honest_and_stores_nothing(make_env: Callable[..., Env]) -> None:
    env = make_env(None)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.get("/api/chat/config").json()["available"] is False
        response = client.post("/api/chat", json={"content": "Oi", "client_id": "abcdefgh1"})
        assert (response.status_code, response.json()) == (503, {"error": "model_unavailable"})
        assert client.get("/api/conversations").json() == {"items": [], "next": None}


def test_resending_the_same_client_id_is_idempotent(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider, hourly=2)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        first = send(client, "Oi", client_id="same-request-1")
        again = send(client, "Oi", client_id="same-request-1")
        assert again[0]["duplicate"] is True
        assert again[0]["reply"]["id"] == first[0]["reply"]["id"]
        assert again[-1]["type"] == "done" and again[-1]["reply"]["content"] == "Olá, tudo certo?"
        assert len(provider.requests) == 1
        conversation_id = first[0]["conversation"]["id"]
        items = client.get(f"/api/conversations/{conversation_id}").json()["messages"]["items"]
        assert len(items) == 2
        # A repetição não gastou cota: ainda cabe mais uma mensagem nesta hora.
        send(client, "Mais uma", conversation_id=conversation_id)


def test_usage_limit_has_exact_reset_time(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider(), hourly=2)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        send(client, "1")
        send(client, "2")
        response = client.post("/api/chat", json={"content": "3", "client_id": "third-msg-1"})
        assert response.status_code == 429
        body = response.json()
        assert body["error"] == "usage_limit"
        assert body["reset_at"] > time.time() and int(response.headers["retry-after"]) > 0


def test_options_are_validated_against_real_capabilities(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider(capabilities=Capabilities()))
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        cases: dict[str, dict[str, Any]] = {
            "invalid_model": {"model": "gpt-5"},
            "invalid_effort": {"effort": "alto"},
            "deep_unavailable": {"deep": True},
            "web_search_unavailable": {"tools": {"web_search": True}},
            "research_unavailable": {"tools": {"research": True}},
        }
        for code, extra in cases.items():
            response = client.post(
                "/api/chat", json={"content": "Oi", "client_id": f"opt-{code}", **extra}
            )
            assert (response.status_code, response.json()["error"]) == (400, code)
        empty = client.post("/api/chat", json={"content": "   ", "client_id": "empty-msg-1"})
        assert empty.json()["error"] == "empty_message"
        assert client.get("/api/conversations").json()["items"] == []


def test_conversations_are_isolated_between_accounts(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        env.signed_in(bia, "bia@example.com")
        stream = send(ana, "Segredo da Ana")
        conversation_id = stream[0]["conversation"]["id"]
        reply_id = stream[0]["reply"]["id"]
        upload = ana.post(
            "/api/attachments",
            content=PNG,
            headers={"Content-Type": "image/png", "X-File-Name": "a.png"},
        )
        attachment_id = upload.json()["attachment"]["id"]

        assert bia.get("/api/conversations").json()["items"] == []
        for method, path in (
            ("GET", f"/api/conversations/{conversation_id}"),
            ("GET", f"/api/conversations/{conversation_id}/messages"),
            ("DELETE", f"/api/conversations/{conversation_id}"),
            ("GET", f"/api/messages/{reply_id}"),
            ("GET", f"/api/messages/{reply_id}/stream"),
            ("GET", f"/api/attachments/{attachment_id}"),
            ("DELETE", f"/api/attachments/{attachment_id}"),
        ):
            response = bia.request(method, path)
            assert (response.status_code, response.json()) == (404, {"error": "not_found"}), path
        rename = bia.post(f"/api/conversations/{conversation_id}", json={"title": "x"})
        assert rename.status_code == 404
        # Bia não consegue escrever na conversa nem usar o anexo da Ana.
        hijack = bia.post(
            "/api/chat",
            json={"content": "oi", "client_id": "hijack-01", "conversation_id": conversation_id},
        )
        assert hijack.status_code == 404
        steal = bia.post(
            "/api/chat",
            json={"content": "oi", "client_id": "steal-001", "attachments": [attachment_id]},
        )
        assert steal.json()["error"] == "attachment_invalid"
        assert ana.get(f"/api/conversations/{conversation_id}").status_code == 200


def test_attachments_are_validated_private_and_sent(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        fake_png = client.post(
            "/api/attachments", content=b"MZ\x90\x00binary",
            headers={"Content-Type": "image/png", "X-File-Name": "virus.png"},
        )
        assert (fake_png.status_code, fake_png.json()["error"]) == (415, "attachment_type")
        cross = client.post(
            "/api/attachments", content=PNG,
            headers={"Content-Type": "image/png", "Origin": "https://evil.example"},
        )
        assert cross.status_code == 403

        image = client.post(
            "/api/attachments", content=PNG,
            headers={"Content-Type": "image/png", "X-File-Name": "..%2F..%2Fetc%2Ffoto.png"},
        ).json()["attachment"]
        assert image["name"] == "foto.png" and image["kind"] == "image"
        notes = client.post(
            "/api/attachments", content=b"# Ideias\nlista",
            headers={"Content-Type": "text/markdown", "X-File-Name": "ideias.md"},
        ).json()["attachment"]

        stream = send(client, "Olha isso", attachments=[image["id"], notes["id"]])
        assert len(stream[0]["message"]["attachments"]) == 2
        parts = provider.requests[-1].turns[-1].parts
        assert [part.kind for part in parts] == ["image", "text", "text"]
        assert parts[0].data == PNG and "ideias.md" in parts[1].text
        assert parts[2].text == "Olha isso"

        served = client.get(f"/api/attachments/{image['id']}")
        assert served.content == PNG and served.headers["content-type"] == "image/png"
        assert served.headers["x-content-type-options"] == "nosniff"
        # Já enviado: não pode ser reutilizado nem apagado como pendente.
        reuse = client.post(
            "/api/chat",
            json={"content": "de novo", "client_id": "reuse-01", "attachments": [image["id"]]},
        )
        assert reuse.json()["error"] == "attachment_invalid"

        files = list((env.settings.upload_dir).rglob("*"))
        assert any(path.is_file() for path in files)
        for path in files:
            if path.is_file():
                assert path.stat().st_mode & 0o077 == 0
        conversation_id = stream[0]["conversation"]["id"]
        assert client.delete(f"/api/conversations/{conversation_id}").status_code == 200
        assert not any(path.is_file() for path in env.settings.upload_dir.rglob("*"))


def test_images_are_refused_when_the_model_cannot_see(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider(capabilities=Capabilities(images=False)))
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        response = client.post(
            "/api/attachments", content=PNG, headers={"Content-Type": "image/png"}
        )
        assert response.json()["error"] == "images_unavailable"


def test_provider_failure_is_reported_and_retryable(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider(error="model_timeout")
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "Oi")
        reply = stream[-1]["reply"]
        assert (reply["status"], reply["error"]) == ("error", "model_timeout")
        provider.error = None
        retry = client.post(f"/api/messages/{reply['id']}/retry", json={})
        retried = events(retry)
        assert retried[-1]["reply"]["status"] == "complete"
        assert retried[-1]["reply"]["id"] == reply["id"]
        again = client.post(f"/api/messages/{reply['id']}/retry", json={})
        assert again.json()["error"] == "not_retryable"


def test_stop_keeps_partial_text(tmp_path: Path) -> None:
    hold = threading.Event()
    provider = FakeProvider(chunks=("Começo",), hold=hold)
    env = Env(tmp_path, provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        user = env.auth.session_user(client.cookies.get("kazer_session"))
        assert user is not None
        exchange, live = env.chat.send(user.id, {"content": "Oi", "client_id": "stop-test-1"})
        assert live is not None
        deadline = time.time() + 2
        while not live.events and time.time() < deadline:
            time.sleep(0.01)
        env.chat.stop(user.id, exchange.reply.id)
        while not live.done and time.time() < deadline:
            time.sleep(0.01)
        message = env.chat.message(user.id, exchange.reply.id)
        assert (message.status, message.content) == ("stopped", "Começo")


def test_settings_memories_and_prompt(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        settings = client.get("/api/settings").json()
        assert settings["preferences"]["style"] == "equilibrado"
        assert settings["account"]["email"] == "ana@example.com"

        bad = client.post("/api/settings", json={"preferences": {"style": "caótico"}})
        assert bad.status_code == 400
        saved = client.post(
            "/api/settings", json={"preferences": {"nickname": "Aninha", "style": "direto"}}
        ).json()["preferences"]
        assert saved["nickname"] == "Aninha"

        memory = client.post("/api/memories", json={"content": "Trabalho com Python"}).json()
        send(client, "Oi")
        assert "Trabalho com Python" in provider.requests[-1].system
        assert "Aninha" in provider.requests[-1].system
        send(client, "Sem memória", tools={"memory": False})
        assert "Trabalho com Python" not in provider.requests[-1].system

        client.post("/api/settings", json={"preferences": {"memory_enabled": False}})
        send(client, "Oi de novo")
        assert "Trabalho com Python" not in provider.requests[-1].system

        assert client.delete(f"/api/memories/{memory['memory']['id']}").status_code == 200
        assert client.get("/api/settings").json()["memories"] == []


def test_account_password_change_and_deletion(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client, env.client() as other_device:
        env.signed_in(client, "ana@example.com")
        login = other_device.post(
            "/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
        )
        assert login.status_code == 200

        wrong = client.post(
            "/api/account/password", json={"current_password": "nope", "password": "x" * 12}
        )
        assert (wrong.status_code, wrong.json()["error"]) == (403, "invalid_password")
        changed = client.post(
            "/api/account/password",
            json={"current_password": PASSWORD, "password": "uma frase nova e longa"},
        )
        assert changed.status_code == 200
        assert client.get("/api/auth/session").json()["authenticated"] is True
        assert other_device.get("/api/auth/session").json()["authenticated"] is False

        send(client, "Algo para exportar")
        export = client.get("/api/account/export")
        assert export.headers["content-disposition"].startswith("attachment")
        assert export.json()["conversations"][0]["messages"][0]["content"] == "Algo para exportar"

        refused = client.post("/api/account/delete", json={"password": "errada"})
        assert refused.status_code == 403
        deleted = client.post("/api/account/delete", json={"password": "uma frase nova e longa"})
        assert deleted.status_code == 200
        assert client.get("/api/auth/session").json()["authenticated"] is False
        relogin = client.post(
            "/api/auth/login",
            json={"email": "ana@example.com", "password": "uma frase nova e longa"},
        )
        assert relogin.status_code == 401


def test_service_worker_and_health(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        worker = client.get("/sw.js")
        assert worker.status_code == 200
        assert worker.headers["service-worker-allowed"] == "/"
        assert client.get("/api/health").json()["ok"] is True
        assert "worker-src 'self'" in client.get("/").headers["content-security-policy"]
