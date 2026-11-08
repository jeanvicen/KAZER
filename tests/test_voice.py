"""Modo voz: tokens curtos, rotas do KAZER e o voice gateway (motores falsos)."""

from __future__ import annotations

import json
import math
import struct
from array import array
from collections.abc import Iterator
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from kazer.auth.service import AuthService
from kazer.auth.store import AuthStore
from kazer.config.settings import Settings, load_settings
from kazer.interfaces.web.app import create_app
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter
from kazer.voice import tokens
from kazer.voice.gateway import (
    CLOSE_BAD_REQUEST,
    CLOSE_FORBIDDEN_ORIGIN,
    CLOSE_TOO_MANY,
    CLOSE_UNAUTHORIZED,
    FRAME_MAX_BYTES,
    PROTOCOL,
    Endpointer,
    GatewayConfig,
    VoiceGateway,
    create_gateway_app,
    rms,
)
from kazer.voice.speech_text import sentences, speakable

SECRET = "s" * 40
ORIGIN = "http://testserver"
AUDIO = {"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1}


# ---------- Tokens ----------


def test_token_round_trip_and_expiry() -> None:
    token, exp = tokens.issue(SECRET, "user-1", conversation_id="c1", ttl=60, now=1000)
    grant = tokens.verify(SECRET, token, now=1030)
    assert (grant.user_id, grant.conversation_id, grant.expires_at) == ("user-1", "c1", exp)
    with pytest.raises(tokens.VoiceTokenError) as info:
        tokens.verify(SECRET, token, now=1061)
    assert info.value.code == "expired_token"


def test_token_tampering_and_wrong_secret_are_rejected() -> None:
    token, _ = tokens.issue(SECRET, "user-1")
    body, sig = token.split(".")
    forged = tokens._b64(
        json.dumps({"v": 1, "sub": "admin", "exp": 9999999999, "jti": "x"}).encode()
    )
    for bad in (f"{forged}.{sig}", f"{body}.AAAA", "garbage", "", "a" * 5000):
        with pytest.raises(tokens.VoiceTokenError):
            tokens.verify(SECRET, bad)
    with pytest.raises(tokens.VoiceTokenError):
        tokens.verify("x" * 40, token)


def test_short_secret_is_refused() -> None:
    with pytest.raises(ValueError):
        tokens.issue("curto", "user-1")


def test_nonce_store_blocks_replay() -> None:
    store = tokens.NonceStore()
    assert store.use("n1", 2000, now=1000)
    assert not store.use("n1", 2000, now=1001)
    assert store.use("n1", 3000, now=2500)  # expirado e limpo: outro token com jti igual


# ---------- Texto falável ----------


def test_speakable_strips_markdown_code_links_and_citations() -> None:
    text = (
        "## Resumo\n\nO **axolote** vive no México [1][2]. Veja https://exemplo.com.\n\n"
        "```python\nprint('oi')\n```\n\n- primeiro item\n1. segundo item"
    )
    spoken = speakable(text)
    assert "**" not in spoken and "#" not in spoken and "https" not in spoken
    assert "[1]" not in spoken and "print(" not in spoken
    assert "o código está na tela" in spoken
    assert "primeiro item" in spoken and "segundo item" in spoken


def test_speakable_reads_question_block() -> None:
    block = (
        '```kazer-pergunta\n{"pergunta": "Qual site?", "opcoes": [{"texto": "Loja"}, "Blog"]}\n```'
    )
    assert speakable(block).strip() == "Qual site? Opções: Loja, Blog."


def test_sentences_merge_tiny_fragments() -> None:
    assert sentences("Sim. Isso funciona muito bem hoje. E amanhã também!") == [
        "Sim. Isso funciona muito bem hoje.",
        "E amanhã também!",
    ]


# ---------- Rotas do KAZER ----------


@pytest.fixture
def web(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("KAZER_VOICE_TOKEN_SECRET", SECRET)
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        database_path=tmp_path / "v.db",
        cookie_secure=False,
        voice_gateway_url="wss://voz.exemplo.com/v1/voice",
    )
    service = AuthService(
        AuthStore(settings.database_path),
        PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
        type("Mail", (), {"send": lambda self, message: None})(),
        RateLimiter(),
        settings.public_origin,
    )
    with TestClient(create_app(settings, service), headers={"Origin": ORIGIN}) as client:
        yield client


def login(client: TestClient, email: str = "ana@example.com") -> None:
    response = client.post(
        "/api/auth/register", json={"email": email, "password": "correct horse battery"}
    )
    assert response.status_code == 201


def test_voice_routes_require_login(web: TestClient) -> None:
    assert web.get("/api/voice/config").status_code == 401
    assert web.post("/api/voice/session", json={}).status_code == 401


def test_voice_session_issues_short_single_use_token(web: TestClient) -> None:
    login(web)
    config = web.get("/api/voice/config").json()
    assert config["engines"] == ["gateway", "browser"]
    assert config["gateway"] == {"url": "wss://voz.exemplo.com/v1/voice"}
    assert SECRET not in json.dumps(config)
    response = web.post("/api/voice/session", json={"conversation_id": "abc"})
    assert response.status_code == 200
    data = response.json()
    assert data["protocol"] == PROTOCOL and SECRET not in json.dumps(data)
    grant = tokens.verify(SECRET, data["token"])
    assert grant.conversation_id == "abc" and grant.expires_at - data["expires_at"] == 0


def test_voice_session_checks_origin_and_input(web: TestClient) -> None:
    login(web)
    evil = web.post("/api/voice/session", json={}, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert web.post("/api/voice/session", json={"conversation_id": "x" * 65}).status_code == 400


def test_voice_session_rate_limit(web: TestClient) -> None:
    login(web)
    statuses = [web.post("/api/voice/session", json={}).status_code for _ in range(21)]
    assert statuses[:20] == [200] * 20 and statuses[20] == 429


def test_csp_allows_only_the_gateway_origin(web: TestClient) -> None:
    csp = web.get("/").headers["content-security-policy"]
    assert "connect-src 'self' wss://voz.exemplo.com;" in csp
    assert "microphone=(self)" in web.get("/").headers["permissions-policy"]
    assert "camera=()" in web.get("/").headers["permissions-policy"]


def test_without_gateway_only_browser_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("KAZER_VOICE_TOKEN_SECRET", raising=False)
    settings = Settings(
        environment="test", public_url=ORIGIN, database_path=tmp_path / "n.db", cookie_secure=False
    )
    service = AuthService(
        AuthStore(settings.database_path),
        PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
        type("Mail", (), {"send": lambda self, message: None})(),
        RateLimiter(),
        settings.public_origin,
    )
    with TestClient(create_app(settings, service), headers={"Origin": ORIGIN}) as client:
        login(client)
        assert client.get("/api/voice/config").json()["engines"] == ["browser"]
        assert client.post("/api/voice/session", json={}).json()["error"] == "voice_unavailable"
        assert "connect-src 'self';" in client.get("/").headers["content-security-policy"]


def test_insecure_gateway_url_is_ignored_in_production() -> None:
    settings = load_settings(
        {"KAZER_ENV": "production", "KAZER_VOICE_GATEWAY_URL": "ws://voz.exemplo.com/v1/voice"}
    )
    assert settings.voice_gateway_origin == ""
    assert load_settings({"KAZER_VOICE_GATEWAY_URL": "https://x.com"}).voice_gateway_origin == ""


# ---------- Gateway ----------


def tone(ms: int, amplitude: float = 0.3) -> bytes:
    count = int(16000 * ms / 1000)
    return struct.pack(
        f"<{count}h",
        *(int(amplitude * 32767 * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(count)),
    )


def silence(ms: int) -> bytes:
    return bytes(int(16000 * ms / 1000) * 2)


class FakeSTT:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def transcribe(self, pcm16: bytes, sample_rate: int) -> str:
        self.calls.append(len(pcm16))
        return "oi kazer tudo bem"


class FakeTTS:
    sample_rate = 24000

    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str) -> Iterator[bytes]:
        self.spoken.append(text)
        yield bytes(4800)


@pytest.fixture
def gateway() -> Iterator[tuple[TestClient, VoiceGateway, FakeSTT, FakeTTS]]:
    stt, tts = FakeSTT(), FakeTTS()
    gw = VoiceGateway(
        GatewayConfig(
            token_secret=SECRET, allowed_origins=frozenset({ORIGIN}), max_sessions_per_user=1
        ),
        stt_factory=lambda: stt,
        tts_factory=lambda: tts,
    )
    with TestClient(create_gateway_app(gw)) as client:
        yield client, gw, stt, tts


def hello(token: str | None = None, **extra: object) -> str:
    return json.dumps(
        {
            "type": "hello",
            "protocol": PROTOCOL,
            "audio": AUDIO,
            "token": token or tokens.issue(SECRET, "u1")[0],
            **extra,
        }
    )


def open_session(client: TestClient):  # type: ignore[no-untyped-def]
    ws = client.websocket_connect("/v1/voice", headers={"origin": ORIGIN})
    socket = ws.__enter__()
    socket.send_text(hello())
    assert socket.receive_json()["type"] == "ready"
    return ws, socket


def closed_with(client: TestClient, message: str | None, code: int, origin: str = ORIGIN) -> dict:
    with client.websocket_connect("/v1/voice", headers={"origin": origin}) as socket:
        if message is not None:
            socket.send_text(message)
        error = socket.receive_json()
        with pytest.raises(WebSocketDisconnect) as info:
            socket.receive_json()
        assert info.value.code == code
        return error


def test_gateway_health_and_metrics(gateway) -> None:  # type: ignore[no-untyped-def]
    client, *_ = gateway
    assert client.get("/healthz").json()["protocol"] == PROTOCOL
    assert client.get("/readyz").status_code == 200
    assert "kazer_voice_sessions_active 0" in client.get("/metrics").text


def test_gateway_rejects_bad_handshakes(gateway) -> None:  # type: ignore[no-untyped-def]
    client, gw, *_ = gateway
    expired = tokens.issue(SECRET, "u1", ttl=-1)[0]
    forged = tokens.issue("y" * 40, "u1")[0]
    assert closed_with(client, "não é json", CLOSE_BAD_REQUEST)["code"] == "malformed"
    assert (
        closed_with(client, json.dumps({"type": "speak"}), CLOSE_UNAUTHORIZED)["code"]
        == "hello_required"
    )
    assert closed_with(client, hello(expired), CLOSE_UNAUTHORIZED)["code"] == "expired_token"
    assert closed_with(client, hello(forged), CLOSE_UNAUTHORIZED)["code"] == "invalid_token"
    bad_audio = json.dumps(
        {
            "type": "hello",
            "protocol": PROTOCOL,
            "token": "x",
            "audio": {**AUDIO, "sample_rate": 44100},
        }
    )
    assert closed_with(client, bad_audio, CLOSE_BAD_REQUEST)["code"] == "unsupported_audio"
    wrong_protocol = json.dumps(
        {"type": "hello", "protocol": "kazer-voice/9", "audio": AUDIO, "token": "x"}
    )
    assert closed_with(client, wrong_protocol, CLOSE_BAD_REQUEST)["code"] == "unsupported_protocol"
    assert gw.metrics.rejected["expired_token"] == 1


def test_gateway_rejects_foreign_origin(gateway) -> None:  # type: ignore[no-untyped-def]
    client, *_ = gateway
    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect(
            "/v1/voice", headers={"origin": "https://evil.example"}
        ) as socket:
            socket.receive_json()
    assert info.value.code == CLOSE_FORBIDDEN_ORIGIN


def test_gateway_blocks_token_replay(gateway) -> None:  # type: ignore[no-untyped-def]
    client, *_ = gateway
    token = tokens.issue(SECRET, "u1")[0]
    with client.websocket_connect("/v1/voice", headers={"origin": ORIGIN}) as socket:
        socket.send_text(hello(token))
        assert socket.receive_json()["type"] == "ready"
    assert closed_with(client, hello(token), CLOSE_UNAUTHORIZED)["code"] == "token_reused"


def test_gateway_limits_sessions_per_user(gateway) -> None:  # type: ignore[no-untyped-def]
    client, *_ = gateway
    ws, socket = open_session(client)
    try:
        assert closed_with(client, hello(), CLOSE_TOO_MANY)["code"] == "too_many_sessions"
        # Outra conta continua podendo entrar.
        with client.websocket_connect("/v1/voice", headers={"origin": ORIGIN}) as other:
            other.send_text(hello(tokens.issue(SECRET, "u2")[0]))
            assert other.receive_json()["type"] == "ready"
    finally:
        ws.__exit__(None, None, None)


def test_gateway_rejects_oversized_frame(gateway) -> None:  # type: ignore[no-untyped-def]
    client, *_ = gateway
    ws, socket = open_session(client)
    try:
        socket.send_bytes(bytes(FRAME_MAX_BYTES + 2))
        assert socket.receive_json()["code"] == "bad_frame"
        with pytest.raises(WebSocketDisconnect) as info:
            socket.receive_json()
        assert info.value.code == CLOSE_BAD_REQUEST
    finally:
        ws.__exit__(None, None, None)


def test_gateway_transcribes_after_silence_and_discards_audio(gateway) -> None:  # type: ignore[no-untyped-def]
    client, gw, stt, _ = gateway
    ws, socket = open_session(client)
    try:
        for chunk in [tone(20)] * 25 + [silence(20)] * 40:  # 0,5 s de fala + 0,8 s de silêncio
            socket.send_bytes(chunk)
        assert socket.receive_json() == {"type": "vad", "speaking": True}
        assert socket.receive_json() == {"type": "vad", "speaking": False}
        transcript = socket.receive_json()
        assert transcript["type"] == "transcript" and transcript["final"] is True
        assert transcript["text"] == "oi kazer tudo bem"
        assert len(stt.calls) == 1
        assert gw.metrics.utterances == 1
        socket.send_text(json.dumps({"type": "unknown"}))
        assert socket.receive_json()["code"] == "unknown_type"
        socket.send_text("{quebrado")
        assert socket.receive_json()["code"] == "malformed"
    finally:
        ws.__exit__(None, None, None)


def test_gateway_ignores_short_noise(gateway) -> None:  # type: ignore[no-untyped-def]
    client, _, stt, _ = gateway
    ws, socket = open_session(client)
    try:
        for chunk in [tone(20)] * 3 + [silence(20)] * 40:  # estalo de 60 ms
            socket.send_bytes(chunk)
        socket.send_text(json.dumps({"type": "ping"}))
        events = [socket.receive_json() for _ in range(3)]
        assert events[-1] == {"type": "pong"}
        assert stt.calls == []
    finally:
        ws.__exit__(None, None, None)


def test_gateway_speaks_clean_text_and_cancels(gateway) -> None:  # type: ignore[no-untyped-def]
    client, gw, _, tts = gateway
    ws, socket = open_session(client)
    try:
        socket.send_text(
            json.dumps(
                {"type": "speak", "id": "r1", "text": "**Oi!** Veja [1] https://x.com agora."}
            )
        )
        start = socket.receive_json()
        assert start == {"type": "audio_start", "id": "r1", "sample_rate": 24000}
        assert socket.receive_bytes() == bytes(4800)
        assert socket.receive_json() == {"type": "audio_end", "id": "r1"}
        assert tts.spoken == ["Oi! Veja agora."]
        socket.send_text(json.dumps({"type": "speak", "id": "r2", "text": "   "}))
        assert socket.receive_json()["code"] == "invalid_speak"
        socket.send_text(json.dumps({"type": "cancel"}))
        socket.send_text(json.dumps({"type": "ping"}))
        assert socket.receive_json() == {"type": "pong"}
    finally:
        ws.__exit__(None, None, None)
    assert gw.active == 0


def test_endpointer_and_level() -> None:
    assert rms(silence(20)) == 0.0
    assert 0.15 < rms(tone(20)) < 0.25
    endpointer = Endpointer()
    events = [endpointer.feed(chunk)[0] for chunk in [tone(20)] * 20 + [silence(20)] * 36]
    assert events.count("start") == 1 and events.count("end") == 1
    assert events.index("end") == 20 + 34  # 700 ms de silêncio = 35 quadros de 20 ms
    samples = array("h")
    samples.frombytes(tone(20))
    assert len(samples) == 320


def test_gateway_queues_sentences_of_one_reply(gateway) -> None:  # type: ignore[no-untyped-def]
    client, _, _, tts = gateway
    ws, socket = open_session(client)
    try:
        for index, text in enumerate(["Primeira frase da resposta.", "Segunda frase aqui."]):
            payload = {"type": "speak", "id": "r9", "text": text, "queue": index > 0}
            socket.send_text(json.dumps(payload))
        events = []
        while not events or events[-1] != {"type": "audio_end", "id": "r9"}:
            message = socket.receive()
            if message.get("text"):
                events.append(json.loads(message["text"]))
        assert events[0] == {"type": "audio_start", "id": "r9", "sample_rate": 24000}
        assert tts.spoken == ["Primeira frase da resposta.", "Segunda frase aqui."]
    finally:
        ws.__exit__(None, None, None)


def test_capacity_counts_handshakes_in_progress() -> None:
    gw = VoiceGateway(GatewayConfig(token_secret=SECRET, max_sessions=1))
    gw.handshaking = 1  # alguém entrando agora
    with TestClient(create_gateway_app(gw)) as client:
        with client.websocket_connect("/v1/voice") as socket:
            assert socket.receive_json()["code"] == "overloaded"
