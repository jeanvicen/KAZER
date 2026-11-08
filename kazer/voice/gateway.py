"""Voice gateway do KAZER: serviço separado, opcional e auto-hospedável.

Fluxo (protocolo kazer-voice/1, documentado em docs/voice/PROTOCOL.md):

    cliente ──hello{token}──▶ gateway         (token curto emitido por /api/voice/session)
    cliente ──PCM16 16 kHz──▶ VAD ─▶ STT ─▶ {"type":"transcript","final":true}
    cliente envia o texto ao /api/chat de sempre (o cérebro é um só)
    cliente ──speak{text}───▶ TTS por frase ─▶ PCM16 24 kHz em binário
    cliente ──cancel────────▶ para a fala na hora (interrupção)

O gateway não tem banco, não tem chave de modelo e não guarda áudio: o áudio
de cada fala vive só na memória até virar texto, e é descartado em seguida.

Rodar: ``python -m kazer.voice.gateway`` (variáveis em docs/voice/DEPLOY.md).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from array import array
from collections import deque
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Protocol

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from kazer.voice import tokens
from kazer.voice.speech_text import MAX_SPEAK_CHARS, sentences, speakable

logger = logging.getLogger("kazer.voice")

PROTOCOL = "kazer-voice/1"
IN_RATE = 16_000  # PCM16 mono do cliente
OUT_RATE = 24_000  # PCM16 mono devolvido pelo TTS
FRAME_MAX_BYTES = 8_192  # ~256 ms a 16 kHz; quadros maiores são recusados
TEXT_MAX_BYTES = 16_384
MAX_QUEUED_SPEAK = 64  # frases na fila de uma mesma resposta
HELLO_TIMEOUT = 5.0

# Códigos de fechamento (4000–4999 são da aplicação).
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN_ORIGIN = 4403
CLOSE_BAD_REQUEST = 4400
CLOSE_TOO_MANY = 4429
CLOSE_OVERLOADED = 4503
CLOSE_TIME_LIMIT = 4408


# ---------- Motores (trocáveis; os reais são importados só quando usados) ----------


class SpeechToText(Protocol):
    def transcribe(self, pcm16: bytes, sample_rate: int) -> str: ...


class TextToSpeech(Protocol):
    sample_rate: int

    def synthesize(self, text: str) -> Iterator[bytes]: ...


class FasterWhisperSTT:
    """faster-whisper (MIT; pesos Whisper MIT). CPU int8 por padrão."""

    def __init__(self, model: str = "small", device: str = "cpu", compute: str = "int8") -> None:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]

        self._model = WhisperModel(model, device=device, compute_type=compute)

    def transcribe(self, pcm16: bytes, sample_rate: int) -> str:
        import numpy as np

        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = self._model.transcribe(
            audio, language="pt", beam_size=1, vad_filter=False, condition_on_previous_text=False
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


class KokoroTTS:
    """Kokoro-82M (pesos Apache-2.0), voz pt-BR. Saída PCM16 24 kHz."""

    sample_rate = OUT_RATE

    def __init__(self, voice: str = "pf_dora") -> None:
        from kokoro import KPipeline  # type: ignore[import-not-found]

        self._pipeline = KPipeline(lang_code="p")
        self._voice = voice

    def synthesize(self, text: str) -> Iterator[bytes]:
        import numpy as np

        for _, _, audio in self._pipeline(text, voice=self._voice):
            samples = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
            yield (samples * 32767).astype(np.int16).tobytes()


# ---------- VAD por energia (sem dependências; Silero entra como opcional) ----------


def rms(pcm16: bytes) -> float:
    """Nível do quadro em 0..1 (raiz da média dos quadrados)."""
    if len(pcm16) < 2:
        return 0.0
    samples = array("h")
    samples.frombytes(pcm16[: len(pcm16) - len(pcm16) % 2])
    total = sum(sample * sample for sample in samples)
    return (total / len(samples)) ** 0.5 / 32768.0


@dataclass
class Endpointer:
    """Decide quando a pessoa terminou de falar: fala seguida de silêncio."""

    threshold: float = 0.012
    silence_ms: int = 700
    min_speech_ms: int = 250
    max_utterance_ms: int = 30_000
    speaking: bool = False
    speech_ms: float = 0.0
    silence_run_ms: float = 0.0
    buffer: bytearray = field(default_factory=bytearray)

    def feed(self, pcm16: bytes) -> tuple[str | None, bytes | None]:
        """Devolve (evento, áudio_da_fala). Evento: 'start', 'end' ou None."""
        ms = len(pcm16) / 2 / IN_RATE * 1000
        loud = rms(pcm16) >= self.threshold
        event: str | None = None
        if loud:
            self.silence_run_ms = 0.0
            if not self.speaking:
                self.speaking = True
                self.speech_ms = 0.0
                event = "start"
            self.speech_ms += ms
        elif self.speaking:
            self.silence_run_ms += ms
        if self.speaking:
            self.buffer += pcm16
            total_ms = len(self.buffer) / 2 / IN_RATE * 1000
            if self.silence_run_ms >= self.silence_ms or total_ms >= self.max_utterance_ms:
                audio = bytes(self.buffer)
                enough = self.speech_ms >= self.min_speech_ms
                self.reset()
                return ("end", audio if enough else None)
        return (event, None)

    def reset(self) -> None:
        self.speaking = False
        self.speech_ms = 0.0
        self.silence_run_ms = 0.0
        self.buffer = bytearray()


# ---------- Configuração ----------


@dataclass
class GatewayConfig:
    """Limites e origens; tudo vem de variáveis de ambiente sem segredo, menos o token."""

    token_secret: str
    allowed_origins: frozenset[str] = frozenset()
    max_sessions: int = 50
    max_sessions_per_user: int = 2
    max_session_seconds: int = 600
    max_frames_per_second: int = 100
    idle_seconds: int = 60

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> GatewayConfig:
        env = dict(os.environ if env is None else env)
        secret = env.get("KAZER_VOICE_TOKEN_SECRET", "")
        origins = frozenset(
            item.strip()
            for item in env.get("KAZER_VOICE_ALLOWED_ORIGINS", "").split(",")
            if item.strip()
        )

        def number(name: str, default: int) -> int:
            try:
                return max(1, int(env.get(name, default)))
            except ValueError:
                return default

        return cls(
            token_secret=secret,
            allowed_origins=origins,
            max_sessions=number("KAZER_VOICE_MAX_SESSIONS", 50),
            max_sessions_per_user=number("KAZER_VOICE_MAX_SESSIONS_PER_USER", 2),
            max_session_seconds=number("KAZER_VOICE_MAX_SESSION_SECONDS", 600),
        )


@dataclass
class Metrics:
    """Contadores simples expostos em /metrics (formato Prometheus)."""

    sessions_active: int = 0
    sessions_total: int = 0
    rejected: dict[str, int] = field(default_factory=dict)
    utterances: int = 0
    stt_ms_total: float = 0.0
    tts_first_audio_ms_total: float = 0.0
    tts_requests: int = 0
    cancels: int = 0

    def reject(self, reason: str) -> None:
        self.rejected[reason] = self.rejected.get(reason, 0) + 1

    def render(self) -> str:
        lines = [
            f"kazer_voice_sessions_active {self.sessions_active}",
            f"kazer_voice_sessions_total {self.sessions_total}",
            f"kazer_voice_utterances_total {self.utterances}",
            f"kazer_voice_stt_ms_total {self.stt_ms_total:.0f}",
            f"kazer_voice_tts_requests_total {self.tts_requests}",
            f"kazer_voice_tts_first_audio_ms_total {self.tts_first_audio_ms_total:.0f}",
            f"kazer_voice_cancels_total {self.cancels}",
        ]
        lines += [
            f'kazer_voice_rejected_total{{reason="{reason}"}} {count}'
            for reason, count in sorted(self.rejected.items())
        ]
        return "\n".join(lines) + "\n"


# ---------- Sessão ----------


class Session:
    """Uma conexão WebSocket autenticada; uma fala sintetizada por vez."""

    def __init__(self, ws: WebSocket, grant: tokens.VoiceGrant, gw: VoiceGateway) -> None:
        self.ws = ws
        self.grant = grant
        self.gw = gw
        self.endpointer = Endpointer()
        self.speak_task: asyncio.Task[None] | None = None
        self.pending: deque[str] = deque()
        self.speak_id = ""
        self.started = time.monotonic()
        self.last_activity = time.monotonic()
        self.window_start = time.monotonic()
        self.window_frames = 0
        self.closed = False

    async def send_json(self, data: dict[str, Any]) -> None:
        if not self.closed and self.ws.application_state == WebSocketState.CONNECTED:
            await self.ws.send_text(json.dumps(data, ensure_ascii=False))

    async def send_bytes(self, data: bytes) -> None:
        if not self.closed and self.ws.application_state == WebSocketState.CONNECTED:
            await self.ws.send_bytes(data)

    def rate_ok(self) -> bool:
        now = time.monotonic()
        if now - self.window_start >= 1.0:
            self.window_start = now
            self.window_frames = 0
        self.window_frames += 1
        return self.window_frames <= self.gw.config.max_frames_per_second

    async def on_audio(self, frame: bytes) -> None:
        if len(frame) > FRAME_MAX_BYTES or len(frame) % 2:
            await self.fail(CLOSE_BAD_REQUEST, "bad_frame")
            return
        if not self.rate_ok():
            await self.fail(CLOSE_TOO_MANY, "frame_rate")
            return
        event, utterance = self.endpointer.feed(frame)
        if event == "start":
            await self.send_json({"type": "vad", "speaking": True})
            # Interrupção: a pessoa falou enquanto o KAZER falava.
            if self.speak_task and not self.speak_task.done():
                await self.cancel_speech(reason="barge_in")
                await self.send_json({"type": "barge_in"})
        elif event == "end":
            await self.send_json({"type": "vad", "speaking": False})
            if utterance:
                await self.transcribe(utterance)

    async def transcribe(self, audio: bytes) -> None:
        started = time.monotonic()
        try:
            async with self.gw.stt_slots:
                text = await run_in_threadpool(self.gw.stt().transcribe, audio, IN_RATE)
        except Exception:  # noqa: BLE001 - motor quebrado não derruba a sessão
            logger.exception("voice.stt_failed")
            await self.send_json({"type": "error", "code": "stt_failed"})
            return
        finally:
            del audio  # nada de áudio guardado
        elapsed = (time.monotonic() - started) * 1000
        self.gw.metrics.utterances += 1
        self.gw.metrics.stt_ms_total += elapsed
        text = (text or "").strip()
        if text:
            await self.send_json(
                {"type": "transcript", "final": True, "text": text[:4000], "stt_ms": round(elapsed)}
            )
        else:
            await self.send_json({"type": "transcript", "final": True, "text": "", "empty": True})

    async def on_text(self, raw: str) -> None:
        if len(raw.encode("utf-8")) > TEXT_MAX_BYTES:
            await self.fail(CLOSE_BAD_REQUEST, "message_too_large")
            return
        try:
            data = json.loads(raw)
        except ValueError:
            await self.send_json({"type": "error", "code": "malformed"})
            return
        if not isinstance(data, dict):
            await self.send_json({"type": "error", "code": "malformed"})
            return
        kind = data.get("type")
        if kind == "speak":
            text = data.get("text")
            speak_id = str(data.get("id") or "")[:64]
            if not isinstance(text, str) or not text.strip():
                await self.send_json({"type": "error", "code": "invalid_speak"})
                return
            text = text[: MAX_SPEAK_CHARS * 2]
            alive = self.speak_task is not None and not self.speak_task.done()
            # "queue": a resposta chega aos poucos e o cliente manda frase a frase.
            if data.get("queue") is True and alive and speak_id == self.speak_id:
                if len(self.pending) >= MAX_QUEUED_SPEAK:
                    await self.send_json({"type": "error", "code": "speak_queue_full"})
                    return
                self.pending.append(text)
                return
            await self.cancel_speech(reason="replaced")
            self.speak_id = speak_id
            self.pending = deque([text])
            self.speak_task = asyncio.create_task(self.speak(speak_id))
        elif kind == "cancel":
            await self.cancel_speech(reason="client")
        elif kind == "ping":
            await self.send_json({"type": "pong"})
        elif kind == "end_utterance":
            # Botão "parar e enviar": fecha a fala sem esperar o silêncio.
            audio = bytes(self.endpointer.buffer)
            enough = self.endpointer.speech_ms >= self.endpointer.min_speech_ms
            self.endpointer.reset()
            if audio and enough:
                await self.transcribe(audio)
        else:
            await self.send_json({"type": "error", "code": "unknown_type"})

    async def speak(self, speak_id: str) -> None:
        tts = self.gw.tts()
        announced = False
        started = time.monotonic()
        first = True
        self.gw.metrics.tts_requests += 1
        try:
            while self.pending:
                clean = speakable(self.pending.popleft())
                if not clean:
                    continue
                if not announced:
                    await self.send_json(
                        {"type": "audio_start", "id": speak_id, "sample_rate": tts.sample_rate}
                    )
                    announced = True
                await self.speak_text(tts, clean, started, first)
                first = False
            if not announced:
                await self.send_json({"type": "audio_end", "id": speak_id, "empty": True})
                return
            await self.send_json({"type": "audio_end", "id": speak_id})
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("voice.tts_failed")
            await self.send_json({"type": "error", "code": "tts_failed", "id": speak_id})

    async def speak_text(self, tts: TextToSpeech, clean: str, started: float, first: bool) -> None:
        """Sintetiza frase a frase: a primeira toca antes de a última ficar pronta."""
        for sentence in sentences(clean):
            async with self.gw.tts_slots:
                chunks = await run_in_threadpool(lambda s=sentence: list(tts.synthesize(s)))
            for chunk in chunks:
                if first:
                    self.gw.metrics.tts_first_audio_ms_total += (time.monotonic() - started) * 1000
                    first = False
                # Quadros pequenos: o cliente agenda e corta rápido ao interromper.
                for offset in range(0, len(chunk), FRAME_MAX_BYTES):
                    await self.send_bytes(chunk[offset : offset + FRAME_MAX_BYTES])
                    await asyncio.sleep(0)

    async def cancel_speech(self, *, reason: str) -> None:
        self.pending.clear()
        task = self.speak_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self.gw.metrics.cancels += 1
            await self.send_json({"type": "audio_cancelled", "id": self.speak_id, "reason": reason})
        self.speak_task = None

    async def fail(self, code: int, reason: str) -> None:
        self.gw.metrics.reject(reason)
        await self.send_json({"type": "error", "code": reason})
        await self.close(code)

    async def close(self, code: int = 1000) -> None:
        if self.closed:
            return
        await self.cancel_speech(reason="closing")
        self.closed = True
        if self.ws.application_state == WebSocketState.CONNECTED:
            await self.ws.close(code)


# ---------- Gateway ----------


class VoiceGateway:
    """Guarda limites, motores e as sessões ativas desta instância."""

    def __init__(
        self,
        config: GatewayConfig,
        *,
        stt_factory: Callable[[], SpeechToText] | None = None,
        tts_factory: Callable[[], TextToSpeech] | None = None,
        stt_concurrency: int = 2,
        tts_concurrency: int = 2,
    ) -> None:
        self.config = config
        self.metrics = Metrics()
        self.nonces = tokens.NonceStore()
        self.sessions: dict[str, list[Session]] = {}
        self._stt_factory = stt_factory or (
            lambda: FasterWhisperSTT(os.environ.get("KAZER_VOICE_STT_MODEL", "small"))
        )
        self._tts_factory = tts_factory or (
            lambda: KokoroTTS(os.environ.get("KAZER_VOICE_TTS_VOICE", "pf_dora"))
        )
        self._stt: SpeechToText | None = None
        self._tts: TextToSpeech | None = None
        # Fila limitada: no máximo N sínteses/transcrições ao mesmo tempo por instância.
        self.stt_slots = asyncio.Semaphore(stt_concurrency)
        self.tts_slots = asyncio.Semaphore(tts_concurrency)
        self.draining = False
        self.handshaking = 0

    def stt(self) -> SpeechToText:
        if self._stt is None:
            self._stt = self._stt_factory()
        return self._stt

    def tts(self) -> TextToSpeech:
        if self._tts is None:
            self._tts = self._tts_factory()
        return self._tts

    @property
    def active(self) -> int:
        return sum(len(items) for items in self.sessions.values())

    async def handle(self, ws: WebSocket) -> None:
        origin = ws.headers.get("origin", "")
        if self.config.allowed_origins and origin and origin not in self.config.allowed_origins:
            self.metrics.reject("origin")
            await ws.close(CLOSE_FORBIDDEN_ORIGIN)
            return
        await ws.accept()
        # Conta também quem ainda está no handshake: numa rajada, todos passariam
        # pela checagem antes de qualquer um virar sessão ativa.
        if self.draining or self.active + self.handshaking >= self.config.max_sessions:
            self.metrics.reject("overloaded")
            await ws.send_text(json.dumps({"type": "error", "code": "overloaded"}))
            await ws.close(CLOSE_OVERLOADED)
            return
        self.handshaking += 1
        try:
            grant = await self._hello(ws)
        finally:
            self.handshaking -= 1
        if grant is None:
            return
        user_sessions = self.sessions.setdefault(grant.user_id, [])
        if len(user_sessions) >= self.config.max_sessions_per_user:
            self.metrics.reject("per_user_limit")
            await ws.send_text(json.dumps({"type": "error", "code": "too_many_sessions"}))
            await ws.close(CLOSE_TOO_MANY)
            if not user_sessions:
                self.sessions.pop(grant.user_id, None)
            return
        session = Session(ws, grant, self)
        user_sessions.append(session)
        self.metrics.sessions_active = self.active
        self.metrics.sessions_total += 1
        limit = min(self.config.max_session_seconds, grant.max_seconds)
        await session.send_json(
            {"type": "ready", "protocol": PROTOCOL, "in_rate": IN_RATE, "max_seconds": limit}
        )
        try:
            while True:
                remaining = limit - (time.monotonic() - session.started)
                if remaining <= 0:
                    await session.fail(CLOSE_TIME_LIMIT, "session_time_limit")
                    break
                timeout = min(remaining, self.config.idle_seconds)
                try:
                    message = await asyncio.wait_for(ws.receive(), timeout=timeout)
                except TimeoutError:
                    idle = time.monotonic() - session.last_activity >= self.config.idle_seconds
                    await session.fail(CLOSE_TIME_LIMIT, "idle" if idle else "session_time_limit")
                    break
                if message["type"] == "websocket.disconnect":
                    break
                session.last_activity = time.monotonic()
                if message.get("bytes") is not None:
                    await session.on_audio(message["bytes"])
                elif message.get("text") is not None:
                    await session.on_text(message["text"])
                if session.closed:
                    break
        except WebSocketDisconnect:
            pass
        finally:
            await session.close()
            user_sessions.remove(session)
            if not user_sessions:
                self.sessions.pop(grant.user_id, None)
            self.metrics.sessions_active = self.active

    async def _hello(self, ws: WebSocket) -> tokens.VoiceGrant | None:
        async def refuse(reason: str, code: int) -> None:
            self.metrics.reject(reason)
            await ws.send_text(json.dumps({"type": "error", "code": reason}))
            await ws.close(code)

        try:
            message = await asyncio.wait_for(ws.receive(), timeout=HELLO_TIMEOUT)
        except TimeoutError:
            await refuse("hello_timeout", CLOSE_UNAUTHORIZED)
            return None
        raw = message.get("text")
        if not raw or len(raw) > TEXT_MAX_BYTES:
            await refuse("hello_required", CLOSE_UNAUTHORIZED)
            return None
        try:
            hello = json.loads(raw)
        except ValueError:
            await refuse("malformed", CLOSE_BAD_REQUEST)
            return None
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            await refuse("hello_required", CLOSE_UNAUTHORIZED)
            return None
        if hello.get("protocol") != PROTOCOL:
            await refuse("unsupported_protocol", CLOSE_BAD_REQUEST)
            return None
        audio = hello.get("audio") or {}
        if (
            not isinstance(audio, dict)
            or audio.get("encoding") != "pcm_s16le"
            or audio.get("sample_rate") != IN_RATE
            or audio.get("channels") != 1
        ):
            await refuse("unsupported_audio", CLOSE_BAD_REQUEST)
            return None
        if not self.config.token_secret:
            await refuse("not_configured", CLOSE_OVERLOADED)
            return None
        try:
            grant = tokens.verify(self.config.token_secret, str(hello.get("token") or ""))
        except tokens.VoiceTokenError as exc:
            await refuse(exc.code, CLOSE_UNAUTHORIZED)
            return None
        if not self.nonces.use(grant.nonce, grant.expires_at):
            await refuse("token_reused", CLOSE_UNAUTHORIZED)
            return None
        return grant


def create_gateway_app(gateway: VoiceGateway | None = None) -> Starlette:
    """App ASGI do gateway (injete motores falsos nos testes)."""
    gw = gateway or VoiceGateway(GatewayConfig.from_env())

    async def health(request: Request) -> Response:
        return JSONResponse({"status": "ok", "protocol": PROTOCOL})

    async def ready(request: Request) -> Response:
        ok = bool(gw.config.token_secret) and not gw.draining and gw.active < gw.config.max_sessions
        return JSONResponse(
            {"ready": ok, "sessions": gw.active, "capacity": gw.config.max_sessions},
            status_code=200 if ok else 503,
        )

    async def metrics(request: Request) -> Response:
        return Response(gw.metrics.render(), media_type="text/plain; version=0.0.4")

    async def socket(ws: WebSocket) -> None:
        await gw.handle(ws)

    async def drain() -> None:
        # Desligamento gracioso: para de aceitar e fecha as sessões abertas.
        gw.draining = True
        for items in list(gw.sessions.values()):
            for session in list(items):
                await session.close(1001)

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await drain()

    app = Starlette(
        routes=[
            Route("/healthz", health),
            Route("/readyz", ready),
            Route("/metrics", metrics),
            WebSocketRoute("/v1/voice", socket),
        ],
        lifespan=lifespan,
    )
    app.state.gateway = gw
    return app


def main() -> None:  # pragma: no cover - ponto de entrada do processo
    import uvicorn

    logging.basicConfig(level=os.environ.get("KAZER_LOG_LEVEL", "INFO"))
    host = os.environ.get("KAZER_VOICE_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", os.environ.get("KAZER_VOICE_PORT", "8081")))
    uvicorn.run(create_gateway_app(), host=host, port=port, ws_max_size=FRAME_MAX_BYTES * 2)


if __name__ == "__main__":  # pragma: no cover
    main()
