"""Rotas do modo voz no KAZER principal.

- GET  /api/voice/config  → o que o cliente pode usar (motor do navegador sempre;
  gateway só se configurado). Sem segredo.
- POST /api/voice/session → token curto (60 s, uso único) para abrir o WebSocket
  do voice gateway. Exige sessão válida e mesma origem. O gateway nunca recebe o
  cookie do navegador, e o app nativo usa o mesmo endpoint com o seu próprio login.

O cérebro não muda: o texto reconhecido vai pelo /api/chat de sempre.
"""

from __future__ import annotations

import logging

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from kazer.auth.service import AuthError
from kazer.config.settings import Settings
from kazer.interfaces.web.common import WebContext, endpoint
from kazer.security.rate_limiter import RateLimit, RateLimiter
from kazer.security.secrets import EnvironmentSecretProvider, SecretNotConfiguredError
from kazer.voice import tokens, tts

logger = logging.getLogger("kazer.voice")

PROTOCOL = "kazer-voice/1"
SESSION_LIMIT = RateLimit(20, 600)  # 20 sessões de voz a cada 10 min por conta
TTS_LIMIT = RateLimit(400, 3600)  # trechos falados por hora por conta (cada um = 1-2 frases)


def voice_routes(ctx: WebContext, settings: Settings) -> list[Route]:
    limiter = RateLimiter()
    gateway = settings.voice_gateway_url if settings.voice_gateway_origin else ""

    def secret() -> str:
        try:
            value = EnvironmentSecretProvider().get_secret(
                "KAZER_VOICE_TOKEN_SECRET", scope="voice"
            )
        except SecretNotConfiguredError:
            return ""
        return value if len(value) >= tokens.MIN_SECRET_LENGTH else ""

    @endpoint
    async def config(request: Request) -> Response:
        await ctx.user(request)
        enabled = bool(gateway and secret())
        return JSONResponse(
            {
                "protocol": PROTOCOL,
                # O motor do navegador sempre existe como reserva (texto só).
                "engines": ["gateway", "browser"] if enabled else ["browser"],
                "gateway": {"url": gateway} if enabled else None,
                # Voz realista gerada no servidor (sem chave: voz do aparelho).
                "tts": {"provider": speech.provider} if (speech := tts.load_config()) else None,
            }
        )

    @endpoint
    async def speak(request: Request) -> Response:
        """Um trecho curto de texto vira MP3 com voz neural (nada é guardado)."""
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request, limit=4096)
        text = data.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > tts.MAX_TTS_CHARS * 2:
            raise AuthError("invalid_request", 400)
        speech = tts.load_config()
        if speech is None:
            raise AuthError("voice_unavailable", 503)
        wait = limiter.hit(f"tts:{user.id}", TTS_LIMIT)
        if wait > 0:
            raise AuthError("rate_limited", 429, retry_after=wait)
        try:
            audio = await run_in_threadpool(tts.synthesize, speech, text)
        except tts.TTSError:
            raise AuthError("voice_failed", 502) from None
        return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    @endpoint
    async def session(request: Request) -> Response:
        user, _ = await ctx.user(request)
        data = await ctx.read_json(request, limit=2048)
        key = secret()
        if not gateway or not key:
            raise AuthError("voice_unavailable", 503)
        wait = limiter.hit(f"voice:{user.id}", SESSION_LIMIT)
        if wait > 0:
            raise AuthError("rate_limited", 429, retry_after=wait)
        conversation = data.get("conversation_id")
        valid = conversation is None or (isinstance(conversation, str) and len(conversation) <= 64)
        if not valid:
            raise AuthError("invalid_request", 400)
        token, expires = await run_in_threadpool(
            tokens.issue, key, user.id, conversation_id=conversation
        )
        logger.info("voice.session_issued")
        return JSONResponse(
            {
                "protocol": PROTOCOL,
                "url": gateway,
                "token": token,
                "expires_at": expires,
                "audio": {"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1},
            }
        )

    return [
        Route("/api/voice/config", config, methods=["GET"]),
        Route("/api/voice/session", session, methods=["POST"]),
        Route("/api/voice/tts", speak, methods=["POST"]),
    ]
