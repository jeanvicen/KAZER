"""Groq como KAZ 1.1: o esforço escolhido troca o modelo, e só o servidor decide qual.

Um servidor HTTP local imita `/chat/completions` (SSE) e registra o que recebeu:
o teste prova modelo por nível, cabeçalho de autorização, raciocínio escondido,
reserva quando um modelo some, e que a chave nunca vaza.
"""

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from kazer.brain.model_provider import (
    CancelToken,
    GenerationRequest,
    GroqProvider,
    Part,
    ProviderError,
    Turn,
    build_provider,
    parse_tier,
)
from kazer.config.settings import Settings
from kazer.security.secrets import SecretProvider
from tests.test_chat import Env, send

KEY = "gsk_test_chave_que_nunca_pode_vazar"


class Groq(BaseHTTPRequestHandler):
    """Imita a API da Groq. `gone` lista modelos que respondem como aposentados."""

    seen: list[dict[str, Any]] = []
    auth: list[str] = []
    gone: set[str] = set()
    status: int = 200

    def log_message(self, *args: Any) -> None:  # noqa: D102
        pass

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length))
        Groq.seen.append(body)
        Groq.auth.append(self.headers.get("authorization", ""))
        if Groq.status != 200:
            self.send_response(Groq.status)
            self.send_header("Retry-After", "7")
            self.end_headers()
            return
        if body["model"] in Groq.gone:
            payload = json.dumps({"error": {"code": "model_decommissioned", "message": "x"}})
            self.send_response(400)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload.encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunks = [
            {"choices": [{"delta": {"reasoning": "segredo do raciocínio"}}]},
            {"choices": [{"delta": {"content": f"resposta de {body['model']}"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        ]
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


@pytest.fixture
def groq_url() -> Iterator[str]:
    Groq.seen, Groq.auth, Groq.gone, Groq.status = [], [], set(), 200
    server = ThreadingHTTPServer(("127.0.0.1", 0), Groq)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/openai/v1"
    finally:
        server.shutdown()
        server.server_close()


def provider(url: str, **kwargs: Any) -> GroqProvider:
    defaults: dict[str, Any] = {
        "base_url": url,
        "api_key": KEY,
        "tiers": {
            "baixo": "small-model",
            "medio": "mid-model:medium",
            "alto": "big-model,backup-model:high",
            "max": "huge-model:high",
        },
        "vision_model": "",
        "max_tokens": 0,
        "timeout": 10.0,
    }
    return GroqProvider(**{**defaults, **kwargs})


def ask(p: GroqProvider, effort: str, *parts: Part) -> str:
    request = GenerationRequest(
        system="s",
        turns=(Turn("user", parts or (Part("text", "oi"),)),),
        effort=effort,
    )
    events = list(p.stream(request, CancelToken()))
    return "".join(e.text for e in events if e.kind == "text")


# ---------- Esforço troca o modelo ----------


def test_each_effort_picks_its_own_model(groq_url: str) -> None:
    p = provider(groq_url)
    assert ask(p, "low") == "resposta de small-model"
    assert ask(p, "medium") == "resposta de mid-model"
    assert ask(p, "high") == "resposta de big-model"
    assert ask(p, "max") == "resposta de huge-model"
    models = [b["model"] for b in Groq.seen]
    assert models == ["small-model", "mid-model", "big-model", "huge-model"]


def test_unknown_or_disabled_effort_falls_to_the_lowest(groq_url: str) -> None:
    p = provider(groq_url)
    # "xhigh" não está na tabela do ambiente: cai no mais baixo, nunca em erro.
    assert ask(p, "xhigh") == "resposta de small-model"


def test_reasoning_is_requested_but_never_shown(groq_url: str) -> None:
    p = provider(groq_url)
    turn = Turn("user", (Part("text", "oi"),))
    request = GenerationRequest(system="s", turns=(turn,), effort="medium")
    events = list(p.stream(request, CancelToken()))
    body = Groq.seen[-1]
    assert body["reasoning_effort"] == "medium"
    # Pede ao provedor para não devolver o raciocínio cru.
    assert body["include_reasoning"] is False
    assert body["stream"] is True
    # Modelo sem nível de raciocínio não recebe parâmetro que ele pode recusar.
    ask(p, "low")
    assert "reasoning_effort" not in Groq.seen[-1]
    assert events  # a resposta chegou
    # O servidor de teste manda o raciocínio mesmo assim: o KAZER o descarta.
    assert all(e.kind != "thinking" for e in events)
    assert "segredo do raciocínio" not in "".join(e.text for e in events)


def test_the_key_goes_in_the_header_only(groq_url: str) -> None:
    p = provider(groq_url)
    ask(p, "low")
    assert Groq.auth[-1] == f"Bearer {KEY}"
    assert KEY not in json.dumps(Groq.seen[-1])
    assert KEY not in repr(p) and KEY not in str(p.__dict__.get("_tiers"))


# ---------- Modelo aposentado ----------


def test_a_retired_model_falls_back_to_the_next_in_the_chain(groq_url: str) -> None:
    Groq.gone = {"big-model"}
    p = provider(groq_url)
    assert ask(p, "high") == "resposta de backup-model"
    assert [b["model"] for b in Groq.seen] == ["big-model", "backup-model"]


def test_when_the_whole_chain_is_gone_the_error_is_generic(groq_url: str) -> None:
    Groq.gone = {"small-model"}
    p = provider(groq_url)
    with pytest.raises(ProviderError) as caught:
        ask(p, "low")
    assert caught.value.code == "model_error"


def test_rate_limit_keeps_its_wait_and_does_not_burn_the_chain(groq_url: str) -> None:
    Groq.status = 429
    p = provider(groq_url)
    with pytest.raises(ProviderError) as caught:
        ask(p, "high")
    assert (caught.value.code, caught.value.retry_after) == ("model_busy", 7.0)
    # Limite de taxa não é modelo sumido: só uma tentativa.
    assert len(Groq.seen) == 1


# ---------- Imagem ----------


def test_images_use_the_vision_model_only_when_configured(groq_url: str) -> None:
    image = Part("image", media_type="image/png", data=b"\x89PNG")
    with_vision = provider(groq_url, vision_model="eyes-model")
    assert ask(with_vision, "low", Part("text", "veja"), image) == "resposta de eyes-model"
    assert with_vision.capabilities.images is True
    assert provider(groq_url).capabilities.images is False


# ---------- Montagem ----------


def test_tier_parsing_ignores_garbage() -> None:
    assert parse_tier("a:low, b ,, bad model, c:weird") == [
        ("a", {"reasoning_effort": "low", "include_reasoning": False}),
        ("b", {}),
        ("c", {}),
    ]


class Env2(SecretProvider):
    def __init__(self, **values: str) -> None:
        self.values = values

    def get_secret(self, name: str, *, scope: str) -> str:
        if name not in self.values or scope != "model":
            raise LookupError(name)
        return self.values[name]


def test_build_provider_needs_the_key_not_a_model_name() -> None:
    settings = Settings(environment="test", model_provider="groq")
    assert settings.model_blockers == []
    assert build_provider(settings, Env2()) is None
    built = build_provider(settings, Env2(GROQ_API_KEY=KEY))
    assert isinstance(built, GroqProvider)
    assert built.capabilities.efforts == ("baixo", "medio", "alto", "extra", "max")
    assert KEY not in repr(built)


def test_environment_overrides_a_single_tier() -> None:
    settings = Settings(
        environment="test", model_provider="groq", groq_tiers={"alto": "outro-modelo:low"}
    )
    built = build_provider(settings, Env2(GROQ_API_KEY=KEY))
    assert isinstance(built, GroqProvider)
    chain = built._tiers["alto"]
    assert chain[0][0] == "outro-modelo"
    # Os outros níveis continuam com o padrão.
    assert built._tiers["max"][0][0].startswith("openai/gpt-oss-120b")


# ---------- Pelo chat ----------


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(prov: Any, **kwargs: Any) -> Env:
        return Env(tmp_path, prov, **kwargs)

    return build


def test_the_browser_only_sees_the_efforts_the_server_offers(
    groq_url: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(provider(groq_url))
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        config = client.get("/api/chat/config").json()
        assert [e["id"] for e in config["efforts"]] == ["baixo", "medio", "alto", "max"]

        # Esforço fora da oferta é recusado no servidor, não só escondido.
        bad = client.post(
            "/api/chat", json={"client_id": "abcdefgh1", "content": "oi", "effort": "extra"}
        )
        assert (bad.status_code, bad.json()["error"]) == (400, "invalid_effort")
        # E o navegador nunca escolhe um modelo por fora.
        sneaky = client.post(
            "/api/chat",
            json={"client_id": "abcdefgh2", "content": "oi", "model": "huge-model"},
        )
        assert sneaky.json()["error"] == "invalid_model"


def test_chosen_effort_reaches_the_matching_model_and_weighs_more(
    groq_url: str, make_env: Callable[..., Env]
) -> None:
    env = make_env(provider(groq_url))
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        usage_before = client.get("/api/settings").json()["usage"]["consumed"]
        stream = send(client, "pergunta leve", effort="baixo")
        assert stream[-1]["reply"]["content"] == "resposta de small-model"
        light = client.get("/api/settings").json()["usage"]["consumed"] - usage_before

        mid = client.get("/api/settings").json()["usage"]["consumed"]
        stream = send(client, "pergunta pesada", effort="max")
        assert stream[-1]["reply"]["content"] == "resposta de huge-model"
        heavy = client.get("/api/settings").json()["usage"]["consumed"] - mid
        assert heavy > light, (light, heavy)
        # O raciocínio cru nunca chegou à tela.
        assert "segredo do raciocínio" not in json.dumps(stream)
