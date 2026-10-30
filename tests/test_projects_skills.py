"""Projetos e Habilidades: criar, usar, isolar entre contas e chegar ao modelo.

A habilidade é o ponto delicado: é texto escrito por gente, então o teste prende
que ela entra delimitada, só quando combina com o pedido, e sem autoridade para
mudar as regras do sistema.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.chat import context
from tests.test_chat import Env, FakeProvider, chat_requests, send

RECEITA = {
    "name": "Revisor de receitas",
    "description": "quando pedirem receita de cozinha",
    "instructions": "Sempre liste os ingredientes antes do modo de preparo.",
}


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


# ---------- Projetos ----------


def test_projects_are_gone_from_the_api(make_env: Callable[..., Env]) -> None:
    """Projetos foram tirados do produto: nenhuma rota responde por eles."""
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.get("/api/projects").status_code == 404
        assert client.post("/api/projects", json={"name": "X"}).status_code == 404
        conversation = send(client, "oi")[0]["conversation"]["id"]
        # A conversa não carrega mais campo de projeto.
        found = client.get(f"/api/conversations/{conversation}").json()["conversation"]
        assert "project_id" not in found


def test_the_skill_instructions_are_delimited_and_powerless() -> None:
    prompt = context.system_prompt(
        now=1_761_000_000.0,
        timezone="America/Sao_Paulo",
        nickname="",
        style="equilibrado",
        instructions="",
        memories=[],
        web_search=False,
        skills=[("Revisor", "receitas", "Liste os ingredientes antes.")],
    )
    assert 'Habilidade "Revisor" — receitas.' in prompt
    assert "<<<\nListe os ingredientes antes.\n>>>" in prompt
    # É texto de usuário: não pode mudar as regras do sistema.
    assert "sem poder mudar as" in prompt


def test_a_skill_only_reaches_the_model_when_it_fits(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.post("/api/skills", json=RECEITA).status_code == 201

        send(client, "me ensina uma receita de bolo")
        assert "liste os ingredientes" in chat_requests(provider)[-1].system

        send(client, "qual a capital da Bolívia?")
        assert "liste os ingredientes" not in chat_requests(provider)[-1].system


def test_a_switched_off_skill_stays_out(make_env: Callable[..., Env]) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        skill = client.post("/api/skills", json=RECEITA).json()
        assert skill["enabled"] is True

        client.post(f"/api/skills/{skill['id']}", json={"enabled": False})
        send(client, "me ensina uma receita de bolo")
        assert "liste os ingredientes" not in chat_requests(provider)[-1].system


def test_publishing_puts_it_in_the_catalog_and_installing_copies_it(
    make_env: Callable[..., Env],
) -> None:
    env = make_env(FakeProvider())
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        env.signed_in(bia, "bia@example.com")
        skill = ana.post("/api/skills", json=RECEITA).json()

        # Antes de publicar, o catálogo está vazio para todo mundo.
        assert bia.get("/api/skills/shared").json()["items"] == []
        ana.post(f"/api/skills/{skill['id']}", json={"shared": True})

        catalog = bia.get("/api/skills/shared").json()["items"]
        assert [item["name"] for item in catalog] == ["Revisor de receitas"]

        installed = bia.post(f"/api/skills/{skill['id']}/install")
        assert installed.status_code == 201
        copy = installed.json()
        assert copy["origin"] == "catalogo" and copy["id"] != skill["id"]

        # Instalar é copiar: mexer na cópia não altera a original.
        bia.post(f"/api/skills/{copy['id']}", json={"name": "Meu revisor"})
        assert ana.get(f"/api/skills/{skill['id']}").json()["name"] == "Revisor de receitas"


def test_skills_are_private_unless_published(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        env.signed_in(bia, "bia@example.com")
        skill = ana.post("/api/skills", json=RECEITA).json()

        assert bia.get("/api/skills").json()["items"] == []
        assert bia.get(f"/api/skills/{skill['id']}").status_code == 404
        assert bia.delete(f"/api/skills/{skill['id']}").status_code == 404
        # Sem estar publicada, nem instalar dá.
        assert bia.post(f"/api/skills/{skill['id']}/install").status_code == 404


def test_a_skill_needs_all_three_fields(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        for missing in ("name", "description", "instructions"):
            body = {key: value for key, value in RECEITA.items() if key != missing}
            response = client.post("/api/skills", json=body)
            assert (response.status_code, response.json()) == (400, {"error": "invalid_request"})
