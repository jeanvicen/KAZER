"""Adaptador compatível com OpenAI contra um servidor SSE local (sem internet)."""

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    OpenAICompatibleProvider,
    Part,
    ProviderError,
    Turn,
    build_provider,
)
from kazer.config.settings import load_settings
from kazer.security.secrets import EnvironmentSecretProvider

SECRET = "sk-test-NAO-DEVE-VAZAR"


class Recorder:
    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.status = 200


@pytest.fixture
def server() -> Iterator[tuple[str, Recorder]]:
    recorder = Recorder()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            pass

        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            recorder.bodies.append(json.loads(self.rfile.read(length)))
            recorder.headers.append(dict(self.headers))
            if recorder.status != 200:
                self.send_response(recorder.status)
                self.end_headers()
                self.wfile.write(b'{"error": {"message": "echo of prompt"}}')
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            chunks = [
                {"choices": [{"delta": {"reasoning_content": "pensando"}}]},
                {"choices": [{"delta": {"content": "Olá"}}]},
                {"choices": [{"delta": {"content": " mundo"}, "finish_reason": "stop"}]},
            ]
            for chunk in chunks:
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.write(b": comentario ignorado\n\ndata: [DONE]\n\n")

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/v1", recorder
    httpd.shutdown()


def _provider(base_url: str, **overrides: Any) -> OpenAICompatibleProvider:
    settings = load_settings(
        {
            "KAZER_MODEL_PROVIDER": "custom",
            "KAZER_MODEL": "modelo-base",
            "KAZER_MODEL_DEEP": "modelo-pensante",
            "KAZER_MODEL_BASE_URL": base_url,
            **overrides,
        }
    )
    provider = build_provider(
        settings, EnvironmentSecretProvider({"KAZER_MODEL_API_KEY": SECRET})
    )
    assert isinstance(provider, OpenAICompatibleProvider)
    return provider


def _request(**kwargs: Any) -> GenerationRequest:
    turn = Turn(
        "user",
        (Part("image", media_type="image/png", data=b"\x89PNG"), Part("text", text="Oi")),
    )
    return GenerationRequest(system="Você é o KAZER.", turns=(turn,), **kwargs)


def test_streams_text_and_reasoning(server: tuple[str, Recorder]) -> None:
    base_url, recorder = server
    provider = _provider(base_url, KAZER_MODEL_VISION="true")
    events = list(provider.stream(_request(), CancelToken()))
    assert [(event.kind, event.text) for event in events] == [
        ("thinking", "pensando"),
        ("text", "Olá"),
        ("text", " mundo"),
        ("stop", "end"),
    ]
    body = recorder.bodies[-1]
    assert body["model"] == "modelo-base" and body["stream"] is True
    assert body["messages"][0] == {"role": "system", "content": "Você é o KAZER."}
    content = body["messages"][1]["content"]
    assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert recorder.headers[-1]["Authorization"] == f"Bearer {SECRET}"
    assert SECRET not in repr(provider)


def test_deep_thinking_switches_to_the_configured_model(server: tuple[str, Recorder]) -> None:
    base_url, recorder = server
    provider = _provider(base_url)
    assert provider.capabilities.deep is True
    list(provider.stream(_request(deep=True), CancelToken()))
    assert recorder.bodies[-1]["model"] == "modelo-pensante"
    assert "reasoning_effort" not in recorder.bodies[-1]

    effort = _provider(base_url, KAZER_MODEL_REASONING="effort")
    list(effort.stream(_request(), CancelToken()))
    assert recorder.bodies[-1]["reasoning_effort"] == "low"


@pytest.mark.parametrize(
    ("status", "code"),
    [(401, "model_auth"), (429, "model_busy"), (400, "model_rejected"), (500, "model_error")],
)
def test_http_errors_map_to_stable_codes(
    server: tuple[str, Recorder], status: int, code: str
) -> None:
    base_url, recorder = server
    recorder.status = status
    with pytest.raises(ProviderError) as caught:
        list(_provider(base_url).stream(_request(), CancelToken()))
    assert caught.value.code == code
    assert "prompt" not in str(caught.value) and SECRET not in str(caught.value)


def test_unreachable_provider() -> None:
    provider = _provider("http://127.0.0.1:9/v1")
    with pytest.raises(ProviderError) as caught:
        list(provider.stream(_request(), CancelToken()))
    assert caught.value.code == "model_unreachable"


def test_build_provider_needs_explicit_configuration() -> None:
    empty = EnvironmentSecretProvider({})
    assert build_provider(load_settings({}), empty) is None
    # Provedor público sem chave: nada de modelo "fingindo" estar conectado.
    xai_settings = load_settings({"KAZER_MODEL_PROVIDER": "xai", "KAZER_MODEL": "grok"})
    assert build_provider(xai_settings, empty) is None
    assert build_provider(load_settings({"KAZER_MODEL_PROVIDER": "xai"}), empty) is None
    xai = build_provider(
        load_settings({"KAZER_MODEL_PROVIDER": "xai", "KAZER_MODEL": "grok"}),
        EnvironmentSecretProvider({"XAI_API_KEY": SECRET}),
    )
    assert xai is not None and xai.capabilities.images is True
    assert xai.capabilities.deep is False and xai.capabilities.web_search is False
    # Segredos de outro escopo não são acessíveis pelo adaptador.
    with pytest.raises(PermissionError):
        EnvironmentSecretProvider({"SMTP_PASSWORD": "x"}).get_secret("SMTP_PASSWORD", scope="model")


def test_anthropic_adapter_uses_the_official_sdk() -> None:
    pytest.importorskip("anthropic")
    provider = build_provider(
        load_settings({"KAZER_MODEL_PROVIDER": "anthropic"}),
        EnvironmentSecretProvider({"ANTHROPIC_API_KEY": SECRET}),
    )
    assert provider is not None
    assert provider.capabilities.deep is True and provider.capabilities.images is True
    assert "claude-opus-5-5" in repr(provider) and SECRET not in repr(provider)
