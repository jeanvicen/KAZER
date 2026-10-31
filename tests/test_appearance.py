"""Tema e idioma: preferências validadas no servidor, e a língua chega ao modelo."""

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


def test_defaults_keep_the_current_look_and_language(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        prefs = client.get("/api/settings").json()["preferences"]
        assert (prefs["theme"], prefs["language"]) == ("escuro", "pt")


def test_theme_and_language_are_saved_and_validated(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        saved = client.post(
            "/api/settings", json={"preferences": {"theme": "claro", "language": "en"}}
        )
        assert saved.json()["preferences"]["theme"] == "claro"
        assert client.get("/api/settings").json()["preferences"]["language"] == "en"
        for bad in ({"theme": "neon"}, {"language": "fr"}, {"language": "../etc"}, {"theme": 1}):
            response = client.post("/api/settings", json={"preferences": bad})
            assert (response.status_code, response.json()["error"]) == (400, "invalid_request")


def test_the_english_interface_asks_the_model_to_answer_in_english(
    make_env: Callable[..., Env],
) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        send(client, "oi")
        assert "Reply in English" not in chat_requests(provider)[-1].system
        client.post("/api/settings", json={"preferences": {"language": "en"}})
        send(client, "hello")
        assert "Reply in English" in chat_requests(provider)[-1].system


def test_the_prompt_stays_in_portuguese_by_default() -> None:
    common: dict[str, Any] = {
        "now": 1_761_000_000.0,
        "timezone": "America/Sao_Paulo",
        "nickname": "",
        "style": "equilibrado",
        "instructions": "",
        "memories": [],
        "web_search": False,
    }
    assert "Reply in English" not in context.system_prompt(**common)
    assert "Reply in English" in context.system_prompt(**common, language="en")


ASSETS = Path(__file__).resolve().parents[1] / "kazer" / "interfaces" / "web" / "static" / "assets"


def test_english_dictionary_is_consistent() -> None:
    """Cada `{nome}` da chave volta na tradução, e nenhuma chave se repete."""
    import json
    import re
    import shutil
    import subprocess

    node = shutil.which("node")
    if node is None:
        pytest.skip("node não está instalado")
    source = (ASSETS / "i18n-en.js").read_text(encoding="utf-8")
    keys = re.findall(r'^  ("(?:[^"\\]|\\.)*"):', source, flags=re.MULTILINE)
    assert len(keys) == len(set(keys)), "chave repetida no dicionário"
    script = (
        f"import('{(ASSETS / 'i18n-en.js').as_posix()}')"
        ".then(m => console.log(JSON.stringify(m.EN)))"
    )
    dictionary = json.loads(
        subprocess.run([node, "-e", script], check=True, capture_output=True, text=True).stdout
    )
    assert len(dictionary) >= 500
    slot = re.compile(r"\{(\w+)\}")
    for key, value in dictionary.items():
        assert set(slot.findall(key)) == set(slot.findall(value)), key
        assert key == key.strip() and value == value.strip(), key
        assert value, key
