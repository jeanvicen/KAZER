"""Conectores que conectam: MCP de verdade, da ligação até o uso na conversa.

Um servidor MCP mínimo sobe num thread local. Nada de rede externa: o teste
conversa com ele por HTTP de verdade, mas em `127.0.0.1`.
"""

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from kazer.brain.model_provider import CancelToken, GenerationRequest, StreamEvent, ToolCall
from kazer.chat import mcp
from tests.test_chat import Env, FakeProvider, chat_requests, send


class McpServer(BaseHTTPRequestHandler):
    """Servidor MCP de teste: anuncia uma ferramenta e responde a ela."""

    calls: list[dict[str, Any]] = []
    token: str = ""

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
        if method == "initialize":
            result: Any = {"protocolVersion": mcp.PROTOCOL_VERSION, "serverInfo": {"name": "t"}}
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "clima",
                        "description": "Diz o tempo de uma cidade",
                        "inputSchema": {"type": "object", "properties": {"cidade": {}}},
                    }
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


# ---------- O endereço ----------


def test_only_https_endpoints_are_accepted() -> None:
    assert mcp.valid_endpoint("https://exemplo.com/mcp")
    # HTTP simples mandaria a credencial em claro.
    assert not mcp.valid_endpoint("http://exemplo.com/mcp")
    assert not mcp.valid_endpoint("https://")
    assert not mcp.valid_endpoint("ftp://exemplo.com")
    # Credencial embutida no host não entra.
    assert not mcp.valid_endpoint("https://user:senha@exemplo.com/mcp")


def test_connecting_needs_a_real_endpoint(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        bad = client.post("/api/connections", json={"url": "http://exemplo.com/mcp"})
        assert (bad.status_code, bad.json()["error"]) == (400, "connector_invalid")
        # Endereço que não responde não vira conector "conectado".
        dead = client.post(
            "/api/connections", json={"url": "https://127.0.0.1:1/mcp", "name": "Nada"}
        )
        assert dead.status_code == 502
        assert client.get("/api/connections").json()["items"] == []


# ---------- Ligar de verdade ----------


def test_the_client_talks_to_a_real_mcp_server(mcp_server: str) -> None:
    client = mcp.McpClient(mcp_server)
    tools = client.connect()
    assert [tool.name for tool in tools] == ["clima"]
    assert client.call("clima", {"cidade": "Natal"}) == "Sol, 28 °C."
    client.close()


def test_the_token_goes_in_the_header_and_never_comes_back(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    McpServer.token = "segredo-do-servico"
    # O endereço local é http; o teste cobre a regra do https em separado.
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))

    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        sem = client.post("/api/connections", json={"url": mcp_server, "name": "Clima"})
        assert sem.status_code == 502, "sem credencial o serviço recusa"

        linked = client.post(
            "/api/connections",
            json={"url": mcp_server, "name": "Clima", "token": "segredo-do-servico"},
        )
        assert linked.status_code == 201
        body = linked.json()
        assert body["connected"] is True
        assert [tool["name"] for tool in body["tools"]] == ["clima"]

        # A credencial e o endereço nunca voltam ao navegador.
        listed = json.dumps(client.get("/api/connections").json())
        assert "segredo-do-servico" not in listed and mcp_server not in listed


def test_a_linked_connector_shows_up_in_the_catalog(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post(
            "/api/connections",
            json={"url": mcp_server, "connector_id": "github", "name": "GitHub"},
        )
        found = client.get("/api/connectors?q=github").json()["items"][0]
        assert found["connected"] is True


# ---------- Usar na conversa ----------


def test_the_model_calls_the_tool_and_gets_the_result(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    provider = ToolProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        client.post("/api/connections", json={"url": mcp_server, "name": "Clima"})

        stream = send(client, "como está o tempo em Natal?")
        assert stream[-1]["reply"]["content"] == "Em Natal faz sol."

        # O servidor MCP foi mesmo chamado, com o argumento do modelo.
        assert McpServer.calls[-1]["arguments"] == {"cidade": "Natal"}

        # A pessoa viu o que estava acontecendo.
        steps = [event["label"] for event in stream if event["type"] == "step"]
        assert any("clima" in label for label in steps)

        # A segunda volta ao modelo levou o resultado como resultado de
        # ferramenta, não como instrução do sistema. (O título usa o mesmo
        # dublê com outro prompt: fica de fora.)
        second = [
            item for item in provider.seen if not item.system.startswith("Dê um título")
        ][-1]
        assert second.turns[-1].results[0][1] == "Sol, 28 °C."
        assert "Sol, 28 °C." not in second.system


def test_a_switched_off_connector_offers_no_tools(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    provider = FakeProvider()
    env = make_env(provider)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        linked = client.post("/api/connections", json={"url": mcp_server, "name": "Clima"}).json()

        send(client, "oi")
        assert chat_requests(provider)[-1].tools, "ligado, a ferramenta é oferecida"

        client.post(f"/api/connections/{linked['id']}", json={"enabled": False})
        send(client, "oi de novo")
        assert chat_requests(provider)[-1].tools == ()


def test_connections_are_private(
    mcp_server: str, make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp, "valid_endpoint", lambda url: url.startswith("http"))
    env = make_env(FakeProvider())
    with env.client() as ana, env.client() as bia:
        env.signed_in(ana, "ana@example.com")
        env.signed_in(bia, "bia@example.com")
        linked = ana.post("/api/connections", json={"url": mcp_server, "name": "Clima"}).json()

        assert bia.get("/api/connections").json()["items"] == []
        theft = bia.post(f"/api/connections/{linked['id']}", json={"enabled": False})
        assert theft.status_code == 404
        assert bia.delete(f"/api/connections/{linked['id']}").status_code == 404

        gone = ana.delete(f"/api/connections/{linked['id']}")
        assert gone.status_code == 200
        assert ana.get("/api/connections").json()["items"] == []
