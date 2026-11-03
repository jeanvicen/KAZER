"""Conectores que conectam: MCP de verdade, da ligação até o uso na conversa.

Um servidor MCP mínimo sobe num thread local. Nada de rede externa: o teste
conversa com ele por HTTP de verdade, mas em `127.0.0.1`.
"""

import json
import sqlite3
import threading
from collections.abc import Callable, Iterator
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from kazer.brain.model_provider import CancelToken, GenerationRequest, StreamEvent, ToolCall
from kazer.chat import connectors, mcp
from kazer.chat.service import ToolSpec
from tests.test_chat import Env, FakeProvider, chat_requests, send


class McpServer(BaseHTTPRequestHandler):
    """Servidor MCP de teste: anuncia uma ferramenta e responde a ela."""

    calls: list[dict[str, Any]] = []
    token: str = ""
    headers: list[dict[str, str]] = []

    def log_message(self, *args: Any) -> None:  # noqa: D102 - silêncio nos testes
        pass

    def do_POST(self) -> None:  # noqa: N802 - nome exigido pela biblioteca
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        if McpServer.token and self.headers.get("authorization") != f"Bearer {McpServer.token}":
            self.send_response(401)
            self.end_headers()
            return
        method = body.get("method")
        McpServer.headers.append({k.lower(): v for k, v in self.headers.items()})
        if method == "initialize":
            result: Any = {"protocolVersion": mcp.PROTOCOL_VERSION, "serverInfo": {"name": "t"}}
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "clima",
                        "description": "Diz o tempo de uma cidade",
                        "inputSchema": {"type": "object", "properties": {"cidade": {}}},
                        "annotations": {"readOnlyHint": True},
                    },
                    {
                        "name": "abrir_pr",
                        "description": "Abre um pull request",
                        "inputSchema": {"type": "object", "properties": {"titulo": {}}},
                        "annotations": {"readOnlyHint": False},
                    },
                ]
            }
        elif method == "tools/call":
            McpServer.calls.append(body.get("params") or {})
            result = {"content": [{"type": "text", "text": "Sol, 28 °C."}]}
        else:
            result = {}
        payload = json.dumps({"jsonrpc": "2.0", "id": body.get("id"), "result": result})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload.encode("utf-8"))


@pytest.fixture
def mcp_server() -> Iterator[str]:
    """Endereço de um servidor MCP vivo durante o teste."""
    McpServer.calls = []
    McpServer.token = ""
    McpServer.headers = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), McpServer)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/mcp"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


class ToolProvider(FakeProvider):
    """Dublê que pede uma ferramenta na primeira volta e responde na segunda."""

    def __init__(self) -> None:
        super().__init__()
        self.rounds = 0
        self.seen: list[GenerationRequest] = []

    def stream(self, request: GenerationRequest, cancel: CancelToken) -> Iterator[StreamEvent]:
        self.requests.append(request)
        self.seen.append(request)
        self.rounds += 1
        if self.rounds == 1:
            yield StreamEvent(
                "tool",
                call=ToolCall(id="c1", name=request.tools[0].name, arguments={"cidade": "Natal"}),
            )
            yield StreamEvent("stop", "tool")
            return
        yield StreamEvent("text", "Em Natal faz sol.")
        yield StreamEvent("stop", "end")


# ---------- Montagem ----------


@pytest.fixture
def github(mcp_server: str, monkeypatch: pytest.MonkeyPatch) -> str:
    """O GitHub do catálogo apontando para o servidor MCP local (em http, só no teste)."""
    local = replace(connectors.BY_ID["github"], endpoint=mcp_server)
    monkeypatch.setitem(connectors.BY_ID, "github", local)
    monkeypatch.setattr(connectors, "CATALOG", (local,))
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    return mcp_server


def paid(env: Env) -> None:
    """Plano com escrita no GitHub (no Supabase é kazer_plans)."""
    original = env.chat.usage_state

    def usage(user_id: str) -> dict[str, Any]:
        base = dict(original(user_id))
        features = {**(base.get("features") or {})}
        features.update({"github_write": True, "connector_limit": 50})
        base["features"] = features
        return base

    env.chat.usage_state = usage  # type: ignore[method-assign]


def owner_of(env: Env, connection_id: str) -> str:
    """Dono da conexão, lido direto do banco local (o teste não tem outro caminho)."""
    with sqlite3.connect(env.settings.database_path) as db:
        row = db.execute(
            "SELECT user_id FROM connections WHERE id = ?", (connection_id,)
        ).fetchone()
    assert row
    return str(row[0])


# ---------- O endereço ----------


def test_only_https_endpoints_are_accepted() -> None:
    assert mcp.valid_endpoint("https://exemplo.com/mcp")
    # HTTP simples mandaria a credencial em claro.
    assert not mcp.valid_endpoint("http://exemplo.com/mcp")
    assert not mcp.valid_endpoint("https://")
    assert not mcp.valid_endpoint("ftp://exemplo.com")
    # Credencial embutida no host não entra.
    assert not mcp.valid_endpoint("https://user:senha@exemplo.com/mcp")


def test_the_address_belongs_to_the_server_never_to_the_browser(
    github: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        # Uma URL de fora é ignorada: o KAZER só fala com o endereço do catálogo.
        linked = client.post(
            "/api/connections",
            json={"connector_id": "github", "token": "ghp_abc", "url": "https://evil.example/mcp"},
        )
        assert linked.status_code == 201, linked.text
        assert McpServer.headers, "o servidor do catálogo foi chamado"
        # Conector fora do catálogo não existe.
        unknown = client.post("/api/connections", json={"connector_id": "outro", "token": "x"})
        assert (unknown.status_code, unknown.json()["error"]) == (404, "connector_unknown")
        # E sem credencial não há ligação.
        missing = client.post("/api/connections", json={"connector_id": "github"})
        assert missing.status_code == 400


def test_a_token_that_could_inject_a_header_is_refused(
    github: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        for bad in ("ghp abc", "ghp_abc\r\nX-Evil: 1", "ghp_a\nbc", "", "   ", "a" * 4001):
            response = client.post(
                "/api/connections", json={"connector_id": "github", "token": bad}
            )
            assert response.status_code == 400, repr(bad)
        assert client.get("/api/connections").json()["items"] == []


def test_an_unreachable_service_never_becomes_connected(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    dead = replace(connectors.BY_ID["github"], endpoint="http://127.0.0.1:1/mcp")
    monkeypatch.setitem(connectors.BY_ID, "github", dead)
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        response = client.post("/api/connections", json={"connector_id": "github", "token": "t"})
        assert response.status_code == 502
        assert client.get("/api/connections").json()["items"] == []


# ---------- Ligar de verdade ----------


def test_the_client_talks_to_a_real_mcp_server(mcp_server: str) -> None:
    client = mcp.McpClient(mcp_server)
    tools = client.connect()
    assert [tool.name for tool in tools] == ["clima", "abrir_pr"]
    assert [tool.read_only for tool in tools] == [True, False]
    assert client.call("clima", {"cidade": "Natal"}) == "Sol, 28 °C."
    client.close()


def test_the_token_goes_in_the_header_and_never_comes_back(
    github: str, make_env: Callable[..., Env]
) -> None:
    McpServer.token = "segredo-do-servico"
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        sem = client.post("/api/connections", json={"connector_id": "github", "token": "errado"})
        assert sem.status_code == 502, "credencial errada: o serviço recusa"

        linked = client.post(
            "/api/connections", json={"connector_id": "github", "token": "segredo-do-servico"}
        )
        assert linked.status_code == 201
        body = linked.json()
        assert body["connected"] is True
        assert [tool["name"] for tool in body["tools"]] == ["clima", "abrir_pr"]

        # A credencial e o endereço nunca voltam ao navegador, em nenhuma listagem.
        shown = json.dumps(
            [client.get("/api/connections").json(), client.get("/api/connectors").json()]
        )
        assert "segredo-do-servico" not in shown and github not in shown


def test_a_linked_connector_shows_up_in_the_catalog(
    github: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"connector_id": "github", "token": "ghp_abc"})
        found = client.get("/api/connectors").json()["items"][0]
        assert (found["connected"], found["enabled"]) == (True, True)
        assert [tool["name"] for tool in found["tools"]] == ["clima", "abrir_pr"]


# ---------- Leitura e escrita ----------


def test_the_free_plan_sends_read_only_and_never_offers_write_tools(
    github: str, make_env: Callable[..., Env]
) -> None:
    provider = ToolProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"connector_id": "github", "token": "ghp_abc"})
        # O pedido de ligação já pediu leitura ao GitHub.
        assert McpServer.headers[0].get("x-mcp-readonly") == "true"

        send(client, "como está o tempo em Natal?")
        offered = [tool.name for tool in provider.seen[0].tools]
        assert offered == ["github__clima"], "só leitura vai ao modelo no plano gratuito"
        # Cada chamada de ferramenta também leva o cabeçalho de leitura.
        assert McpServer.headers[-1].get("x-mcp-readonly") == "true"


def test_a_write_tool_the_model_asks_for_anyway_is_refused_by_the_server(
    github: str, make_env: Callable[..., Env]
) -> None:
    """O modelo pode pedir o que não foi oferecido: quem trava é o servidor."""
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"connector_id": "github", "token": "ghp_abc"})
        conn = client.get("/api/connections").json()["items"][0]["id"]
        calls_before = len(McpServer.calls)
        out = env.chat.run_tool(
            owner_of(env, conn),
            ToolSpec("github__abrir_pr", "", conn, "abrir_pr", "GitHub", 1),
            {"titulo": "x"},
        )
        assert "plano Pro" in out
        assert len(McpServer.calls) == calls_before, "a ferramenta de escrita nem foi chamada"


def test_the_paid_plan_offers_and_runs_write_tools(
    github: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(FakeProvider())
    paid(env)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"connector_id": "github", "token": "ghp_abc"})
        # Plano com escrita: nada de cabeçalho de leitura.
        assert "x-mcp-readonly" not in McpServer.headers[0]
        conn = client.get("/api/connections").json()["items"][0]["id"]
        owner = owner_of(env, conn)
        offered = [spec.tool_name for spec in env.chat._tools_for(owner)]
        assert offered == ["clima", "abrir_pr"]
        out = env.chat.run_tool(
            owner, ToolSpec("github__abrir_pr", "", conn, "abrir_pr", "GitHub", 1), {"titulo": "x"}
        )
        assert out == "Sol, 28 °C."  # o servidor de teste responde igual a qualquer chamada
        assert McpServer.calls[-1]["name"] == "abrir_pr"


# ---------- Usar na conversa ----------


def test_the_model_calls_the_tool_and_gets_the_result(
    github: str, make_env: Callable[..., Env]
) -> None:
    provider = ToolProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"connector_id": "github", "token": "ghp_abc"})

        stream = send(client, "como está o tempo em Natal?")
        assert stream[-1]["reply"]["content"] == "Em Natal faz sol."

        # O servidor MCP foi mesmo chamado, com o argumento do modelo.
        assert McpServer.calls[-1]["arguments"] == {"cidade": "Natal"}

        # A pessoa viu o que estava acontecendo.
        steps = [event["label"] for event in stream if event["type"] == "step"]
        assert any("GitHub" in label or "clima" in label for label in steps)

        # A segunda volta ao modelo levou o resultado como resultado de
        # ferramenta, não como instrução do sistema. (O título usa o mesmo
        # dublê com outro prompt: fica de fora.)
        second = [
            item for item in provider.seen if not item.system.startswith("Dê um título")
        ][-1]
        assert second.turns[-1].results[0][1] == "Sol, 28 °C."
        assert "Sol, 28 °C." not in second.system


def test_a_switched_off_connector_offers_no_tools(
    github: str, make_env: Callable[..., Env]
) -> None:
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        linked = client.post(
            "/api/connections", json={"connector_id": "github", "token": "ghp_abc"}
        ).json()

        send(client, "oi")
        assert chat_requests(provider)[-1].tools, "ligado, a ferramenta é oferecida"

        client.post(f"/api/connections/{linked['id']}", json={"enabled": False})
        send(client, "oi de novo")
        assert chat_requests(provider)[-1].tools == ()


def test_connections_are_private(github: str, make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        env.signed_in(bia, "bia@example.com")
        linked = ana.post(
            "/api/connections", json={"connector_id": "github", "token": "ghp_abc"}
        ).json()

        assert bia.get("/api/connections").json()["items"] == []
        theft = bia.post(f"/api/connections/{linked['id']}", json={"enabled": False})
        assert theft.status_code == 404
        assert bia.delete(f"/api/connections/{linked['id']}").status_code == 404

        gone = ana.delete(f"/api/connections/{linked['id']}")
        assert gone.status_code == 200
        assert ana.get("/api/connections").json()["items"] == []
