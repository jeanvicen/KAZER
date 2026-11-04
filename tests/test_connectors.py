"""A interface e API não expõem conectores enquanto estão pausados."""

from pathlib import Path

from kazer.chat import plans
from tests.test_chat import Env, FakeProvider


def test_connector_capabilities_are_disabled_on_every_plan() -> None:
    for plan in plans.PLANS:
        features = plan.public()["features"]
        assert "connector_limit" not in features
        assert "github_write" not in features


def test_connector_catalog_route_is_not_exposed(tmp_path: Path) -> None:
    env = Env(tmp_path, FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.get("/api/connectors").status_code == 404


def test_chat_service_returns_no_external_tools(tmp_path: Path) -> None:
    env = Env(tmp_path, FakeProvider())
    assert env.chat._tools_for("any-account") == []
