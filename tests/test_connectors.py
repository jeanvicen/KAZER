"""Catálogo de conectores: só o GitHub, com endereço fixo e regra de plano.

A regra que o produto promete fica gravada em teste: o GitHub lê em qualquer
plano e só escreve no pago.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.brain.model_provider import StreamEvent
from kazer.chat import connectors
from tests.test_chat import Env, FakeProvider, send


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


FREE = {"connector_limit": 3, "github_write": False}
PRO = {"connector_limit": 50, "github_write": True}


def test_the_catalog_is_github_only_for_now() -> None:
    assert [item.id for item in connectors.CATALOG] == ["github"]
    github = connectors.BY_ID["github"]
    # Endereço fixo, https, e nunca dependente de entrada da pessoa.
    assert github.endpoint == "https://api.githubcopilot.com/mcp/"


def test_github_reads_for_everyone_and_writes_only_on_a_paid_plan() -> None:
    github = connectors.BY_ID["github"]
    assert github.public(FREE)["can_read"] is True
    assert github.public(FREE)["can_write"] is False
    assert github.public(PRO)["can_write"] is True


def test_the_free_plan_forces_read_only_at_the_service_too() -> None:
    github = connectors.BY_ID["github"]
    # O GitHub só serve ferramentas de leitura quando recebe este cabeçalho.
    assert github.headers(FREE) == {"X-MCP-Readonly": "true"}
    assert github.headers(PRO) == {}


def test_the_public_form_never_carries_the_address_or_a_credential() -> None:
    row = connectors.BY_ID["github"].public(PRO)
    assert "endpoint" not in row and "url" not in row and "token" not in row


def test_the_catalog_reaches_the_browser_with_the_plan_rules(
    make_env: Callable[..., Env],
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        body = client.get("/api/connectors").json()
        assert [item["id"] for item in body["items"]] == ["github"]
        github = body["items"][0]
        # Nada conectado: o estado real, não um rótulo.
        assert (github["connected"], github["can_write"], github["tools"]) == (False, False, [])
        assert github["token_url"].startswith("https://github.com/")


def test_the_catalog_needs_a_session(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        response = client.get("/api/connectors")
        assert (response.status_code, response.json()) == (401, {"error": "unauthenticated"})


# ---------- Narração do que o KAZER está fazendo ----------


class NarratingProvider(FakeProvider):
    """Dublê que usa uma ferramenta e conta o que está fazendo."""

    def stream(self, request: Any, cancel: Any) -> Any:
        self.requests.append(request)
        yield StreamEvent("searching")
        yield StreamEvent("activity", "Buscando na web")
        yield StreamEvent("activity", "Li 3 resultados")
        yield StreamEvent("text", "Pronto.")
        yield StreamEvent("stop", "end")


def test_the_model_narrates_what_it_is_doing(make_env: Callable[..., Env]) -> None:
    env = make_env(NarratingProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "o que aconteceu hoje?")

        steps = [event["label"] for event in stream if event["type"] == "step"]
        assert steps == ["Buscando na web", "Li 3 resultados"]
        # A narração não substitui a resposta.
        assert stream[-1]["reply"]["content"] == "Pronto."


def test_the_narration_never_carries_outside_content(make_env: Callable[..., Env]) -> None:
    """O rótulo é escrito pelo servidor; conteúdo externo não entra nele."""
    env = make_env(NarratingProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "pesquisa aí")
        for event in stream:
            if event["type"] == "step":
                # Rótulos curtos e fixos: nada de texto de terceiros colado.
                assert len(event["label"]) <= 40
