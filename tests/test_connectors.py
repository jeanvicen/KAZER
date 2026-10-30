"""Catálogo de conectores: tamanho, regras de plano, peso e busca.

As regras que o produto promete ficam gravadas em teste: GitHub lê em qualquer
plano e só escreve no pago; Canva entra no gratuito mas custa mais da franquia.
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


FREE = {"connector_limit": 3}
PRO = {"connector_limit": 50}
ULTRA = {"connector_limit": 500}


def test_the_catalog_has_more_than_five_hundred_connectors() -> None:
    assert len(connectors.CATALOG) > 500
    assert len(connectors.CATEGORIES) >= 20
    # Nenhum identificador repetido: o mesmo produto não entra duas vezes.
    assert len({item.id for item in connectors.CATALOG}) == len(connectors.CATALOG)
    # Toda categoria anunciada tem conector.
    used = {item.category for item in connectors.CATALOG}
    assert used == set(connectors.CATEGORIES)


def test_github_reads_for_everyone_and_writes_only_on_a_paid_plan() -> None:
    github = connectors.BY_ID["github"]
    assert github.public(FREE)["can_read"] is True
    assert github.public(FREE)["can_write"] is False
    assert github.public(PRO)["can_write"] is True
    assert github.public(ULTRA)["can_write"] is True


def test_canva_is_open_to_everyone_but_costs_more() -> None:
    canva = connectors.BY_ID["canva"]
    assert canva.public(FREE)["can_write"] is True
    # O limite acaba mais rápido conforme a tarefa, não conforme o relógio.
    assert canva.weight == connectors.WEIGHT_HEAVY
    assert canva.weight > connectors.BY_ID["trello"].weight
    assert connectors.weight_of(["canva", "trello"]) == canva.weight + 1


def test_nothing_is_connected_yet() -> None:
    # Dizer o contrário seria mentira: não existe conexão nenhuma.
    assert all(not item.public(ULTRA)["connected"] for item in connectors.CATALOG)


def test_some_connectors_need_the_top_plan() -> None:
    stripe = connectors.BY_ID["stripe"]
    assert stripe.public(PRO)["can_write"] is False
    assert stripe.public(ULTRA)["can_write"] is True


def test_search_finds_by_name_and_category() -> None:
    found, total = connectors.search("notion")
    # O catálogo tem Notion, Notion Databases e Notion AI: a busca traz os três.
    assert {"notion", "notion-databases", "notion-ai"} == {item.id for item in found}
    assert total == 3

    # Busca por pedaço do nome pega todos os que contêm o trecho.
    found, _ = connectors.search("note")
    names = {item.id for item in found}
    assert {"evernote", "onenote", "apple-notes"} <= names

    found, total = connectors.search("", "Bancos de dados", limit=5)
    assert len(found) == 5 and total > 5
    assert all(item.category == "Bancos de dados" for item in found)

    # Busca sem resultado devolve vazio, não o catálogo inteiro.
    assert connectors.search("servicoquenaoexiste") == ([], 0)


def test_the_catalog_reaches_the_browser_with_the_plan_rules(
    make_env: Callable[..., Env],
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        data = client.get("/api/connectors").json()
        assert data["total"] > 500
        assert len(data["items"]) == 60 and data["has_more"] is True
        # Ligar um serviço depende do endereço MCP dele, que a pessoa informa:
        # a porta existe, e é a do conector próprio.
        assert data["connecting_open"] is True
        # Nada ligado ainda nesta conta.
        assert all(item["connected"] is False for item in data["items"])
        assert len(data["categories"]) >= 20

        github = client.get("/api/connectors?q=github").json()["items"][0]
        assert github["name"] == "GitHub"
        assert github["can_read"] is True and github["can_write"] is False
        assert github["write_plan"] == "pro"

        # Paginação anda.
        second = client.get("/api/connectors?page=1").json()
        assert second["page"] == 1
        first_ids = {item["id"] for item in data["items"]}
        assert not first_ids & {item["id"] for item in second["items"]}


def test_a_bogus_filter_is_refused(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        bad = client.get("/api/connectors?category=Teletransporte")
        assert (bad.status_code, bad.json()) == (400, {"error": "invalid_request"})
        assert client.get("/api/connectors?page=-1").status_code == 400


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
