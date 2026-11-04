"""Os conectores estão pausados temporariamente e não podem ser usados."""

from pathlib import Path

from tests.test_chat import Env, FakeProvider


def test_connection_api_is_not_exposed(tmp_path: Path) -> None:
    env = Env(tmp_path, FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        assert client.get("/api/connections").status_code == 404
        response = client.post("/api/connections", json={"connector_id": "github", "token": "x"})
        assert response.status_code == 404
        assert client.delete("/api/connections/abcdefgh").status_code == 404


def test_stored_connections_are_never_offered_to_the_model(tmp_path: Path) -> None:
    env = Env(tmp_path, FakeProvider())
    assert env.chat._tools_for("any-account") == []
