"""Regressão da API de projetos removida."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from tests.test_chat import Env, FakeProvider, send


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)
    return build


def test_projects_are_gone_from_the_api(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.get("/api/projects").status_code == 404
        assert client.post("/api/projects", json={"name": "X"}).status_code == 404
        conversation = send(client, "oi")[0]["conversation"]["id"]
        found = client.get(f"/api/conversations/{conversation}").json()["conversation"]
        assert "project_id" not in found
