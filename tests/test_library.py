"""Biblioteca: o que o KAZER produziu e o que a pessoa enviou, num lugar só.

O reconhecimento de artefatos é do servidor e não depende de ferramenta do
provedor: o dublê devolve uma resposta com blocos cercados e o que vira
artefato (e o que não vira) é conferido aqui.
"""

import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.chat import artifacts
from tests.test_chat import PNG, Env, FakeProvider, send

PAGINA = "<!doctype html>\n<html>\n" + "<p>linha</p>\n" * 60 + "</html>"
ICONE = '<svg viewBox="0 0 10 10">' + "<rect x='1' y='1' width='8' height='8'/>" * 30 + "</svg>"


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


def _owner_of(env: Env, email: str) -> str:
    """Id da conta no banco de autenticação (o store do chat trabalha com ele)."""
    with sqlite3.connect(env.settings.database_path) as conn:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    assert row, f"conta {email} não encontrada"
    return str(row[0])


# ---------- Reconhecimento ----------


def test_short_blocks_stay_in_the_conversation() -> None:
    answer = "Veja:\n\n```python\nprint('oi')\n```\n\nSó isso."
    assert artifacts.extract(answer) == []


def test_a_full_page_becomes_an_artifact() -> None:
    answer = f"Aqui está a sua landing page:\n\n```html\n{PAGINA}\n```\n"
    found = artifacts.extract(answer)
    assert len(found) == 1
    assert found[0].kind == "code" and found[0].language == "html"
    # O título sai da frase que apresenta o bloco.
    assert found[0].title == "Aqui está a sua landing page"
    assert found[0].content.startswith("<!doctype html>")


def test_the_kind_follows_the_language() -> None:
    answer = f"```svg icone.svg\n{ICONE}\n```"
    found = artifacts.extract(answer)
    assert len(found) == 1
    assert found[0].kind == "image"
    # Título escrito na própria cerca ganha de tudo.
    assert found[0].title == "icone.svg"


def test_a_fence_without_a_language_is_not_an_artifact() -> None:
    assert artifacts.extract("```\n" + "saída de terminal\n" * 60 + "```") == []


def test_at_most_four_artifacts_per_reply() -> None:
    answer = "".join(f"Arquivo {i}\n\n```html\n{PAGINA}\n```\n\n" for i in range(8))
    assert len(artifacts.extract(answer)) == artifacts.MAX_PER_REPLY


# ---------- Ponta a ponta ----------


def test_the_reply_fills_the_library(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider(chunks=("Aqui está a sua página:\n\n```html\n", PAGINA, "\n```\n"))
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "faz uma página")
        kinds = [event["type"] for event in stream]
        assert "artifacts" in kinds

        made = next(event for event in stream if event["type"] == "artifacts")
        assert len(made["items"]) == 1
        item = made["items"][0]
        assert item["source"] == "kazer" and item["kind"] == "code"
        assert item["size"] == len(PAGINA)
        # A listagem nunca carrega o conteúdo.
        assert "content" not in item

        page = client.get("/api/library").json()
        assert [row["id"] for row in page["items"]] == [item["id"]]
        assert page["has_more"] is False

        # O conteúdo só vem quando pedido pelo id.
        full = client.get(f"/api/artifacts/{item['id']}").json()
        assert full["content"] == PAGINA

        # E a mensagem recarregada continua apontando para ele.
        conversation = stream[0]["conversation"]["id"]
        messages = client.get(f"/api/conversations/{conversation}/messages").json()
        reply = messages["items"][-1]
        assert [row["id"] for row in reply["artifacts"]] == [item["id"]]


def test_the_library_mixes_what_was_sent_and_what_was_made(
    make_env: Callable[..., Env],
) -> None:
    provider = FakeProvider(chunks=("```html\n", PAGINA, "\n```"))
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        upload = client.post(
            "/api/attachments",
            content=PNG,
            headers={"Content-Type": "image/png", "X-File-Name": "foto.png"},
        )
        assert upload.status_code == 201, upload.text
        send(client, "olha essa foto", attachments=[upload.json()["attachment"]["id"]])

        tudo = client.get("/api/library").json()["items"]
        assert {row["source"] for row in tudo} == {"pessoa", "kazer"}

        imagens = client.get("/api/library?kind=imagem").json()["items"]
        assert [row["source"] for row in imagens] == ["pessoa"]
        assert imagens[0]["title"] == "foto.png"

        feitos = client.get("/api/library?kind=artefato").json()["items"]
        assert [row["source"] for row in feitos] == ["kazer"]

        assert client.get("/api/library?kind=documento").json()["items"] == []
        # Filtro inventado é recusado em vez de virar "tudo".
        bad = client.get("/api/library?kind=musica")
        assert (bad.status_code, bad.json()) == (400, {"error": "invalid_request"})


def test_regenerating_replaces_the_artifacts(make_env: Callable[..., Env]) -> None:
    """A mesma resposta, gerada de novo, troca os artefatos em vez de acumular."""
    provider = FakeProvider(chunks=("```html\n", PAGINA, "\n```"))
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "faz uma página")
        first = next(e for e in stream if e["type"] == "artifacts")["items"][0]["id"]
        conversation = stream[0]["conversation"]["id"]
        reply_id = stream[-1]["reply"]["id"]

        store = env.chat._store
        owner = _owner_of(env, "ana@example.com")
        saved = store.save_artifacts(
            owner, conversation, reply_id, [("code", "Página nova", "html", PAGINA)], 0
        )
        assert len(saved) == 1 and saved[0].id != first

        items = client.get("/api/library?kind=artefato").json()["items"]
        assert len(items) == 1 and items[0]["id"] != first
        assert client.get(f"/api/artifacts/{first}").status_code == 404


def test_each_reply_adds_its_own_artifacts(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider(chunks=("```html\n", PAGINA, "\n```"))
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        stream = send(client, "faz uma página")
        conversation = stream[0]["conversation"]["id"]
        send(client, "faz outra", conversation_id=conversation)

        items = client.get("/api/library?kind=artefato").json()["items"]
        assert len(items) == 2
        # Mais recente primeiro.
        assert items[0]["created_at"] >= items[1]["created_at"]


def test_the_library_is_private_to_its_owner(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider(chunks=("```html\n", PAGINA, "\n```"))
    env = make_env(provider)
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        stream = send(ana, "faz uma página")
        item = next(e for e in stream if e["type"] == "artifacts")["items"][0]["id"]

        env.signed_in(bia, "bia@example.com")
        assert bia.get("/api/library").json()["items"] == []
        assert bia.get(f"/api/artifacts/{item}").status_code == 404
        removal = bia.delete(f"/api/artifacts/{item}", headers={"origin": "http://testserver"})
        assert removal.status_code == 404

        # A dona continua com o dela e pode apagar.
        assert ana.get(f"/api/artifacts/{item}").status_code == 200
        gone = ana.delete(f"/api/artifacts/{item}", headers={"origin": "http://testserver"})
        assert gone.status_code == 200
        assert ana.get("/api/library?kind=artefato").json()["items"] == []


def test_the_export_carries_the_artifacts(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider(chunks=("```html\n", PAGINA, "\n```"))
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        send(client, "faz uma página")
        data = client.get("/api/account/export").json()
        assert len(data["artifacts"]) == 1
        # Portabilidade é do conteúdo inteiro, não só do nome.
        assert data["artifacts"][0]["content"] == PAGINA
