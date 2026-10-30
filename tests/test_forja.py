"""Forja: a oficina de código, liberada só nos planos pagos.

A trava é do servidor. A interface pode esconder o botão, mas quem decide é o
plano da conta — então o teste bate direto na API.
"""

import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.chat import context
from tests.test_chat import Env, FakeProvider, chat_requests, send


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


def _promote(env: Env, email: str) -> None:
    """Simula um plano pago no armazenamento local (no Supabase é kazer_plans)."""
    with sqlite3.connect(env.settings.database_path) as conn:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    assert row
    env.chat.usage_state = lambda user_id, _owner=str(row[0]): (  # type: ignore[method-assign]
        {
            "plan": "pro",
            "plan_name": "KAZER Pro",
            "allowance": 800,
            "consumed": 0,
            "window_hours": 5,
            "features": {"coder": True, "artifacts": True, "research": True},
        }
        if user_id == _owner
        else {"plan": "free", "features": {"coder": False}}
    )


# ---------- Instruções ----------


def test_the_forja_instructions_only_appear_in_forja() -> None:
    common = {
        "now": 1_761_000_000.0,
        "timezone": "America/Sao_Paulo",
        "nickname": "",
        "style": "equilibrado",
        "instructions": "",
        "memories": [],
        "web_search": False,
    }
    plain = context.system_prompt(**common)
    forged = context.system_prompt(**common, forja=True)
    assert "modo Forja" not in plain
    assert "modo Forja" in forged
    # O que a Forja promete: arquivo inteiro, com nome, e nada inventado.
    assert "arquivos completos" in forged
    assert "nome do arquivo" in forged
    assert "Não invente APIs" in forged


# ---------- Trava ----------


def test_the_free_plan_cannot_open_the_forja(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        response = client.post(
            "/api/chat", json={"content": "faz um app", "client_id": "forja-001", "forja": True}
        )
        assert response.status_code == 402
        body = response.json()
        assert body["error"] == "plan_required" and body["feature"] == "forja"
        # Vem com a oferta certa, não só com a recusa.
        assert body["upgrade"]["id"] == "pro"

        # E a conversa normal continua funcionando.
        assert send(client, "e sem a forja?")


def test_a_paid_plan_opens_the_forja(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        _promote(env, "ana@example.com")

        stream = send(client, "faz um app de tarefas", forja=True)
        assert stream[-1]["reply"]["status"] == "complete"

        request = chat_requests(provider)[-1]
        assert "modo Forja" in request.system

        # O modo fica gravado com a mensagem, para auditoria e para regerar.
        conversation = stream[0]["conversation"]["id"]
        items = client.get(f"/api/conversations/{conversation}/messages").json()["items"]
        assert items[0]["options"]["forja"] is True


def test_a_forged_flag_outside_the_plan_never_reaches_the_model(
    make_env: Callable[..., Env],
) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post(
            "/api/chat", json={"content": "x", "client_id": "forja-002", "forja": True}
        )
        # Nada foi pedido ao modelo: a recusa veio antes.
        assert chat_requests(provider) == []


def test_forja_must_be_a_boolean(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        response = client.post(
            "/api/chat", json={"content": "x", "client_id": "forja-003", "forja": "sim"}
        )
        assert (response.status_code, response.json()) == (400, {"error": "invalid_request"})


def test_the_plans_endpoint_says_who_can_forge(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        free = client.get("/api/plans").json()
        assert free["usage"]["features"]["coder"] is False
        # O catálogo diz onde a Forja entra.
        coder = [plan["id"] for plan in free["plans"] if plan["features"]["coder"]]
        assert coder == ["pro", "ultra"]
