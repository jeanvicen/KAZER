"""Voz realista no servidor: texto → MP3 por uma API de voz neural.

Provedores (escolhidos por `KAZER_TTS_PROVIDER` ou, se vazio, pela chave que existir):
- ElevenLabs (`ELEVENLABS_API_KEY`): modelo multilíngue de baixa latência,
  a voz mais natural em português hoje;
- OpenAI (`OPENAI_API_KEY`): `gpt-4o-mini-tts`, a família de voz do ChatGPT,
  com instrução de falar em português do Brasil.

Sem chave, não há voz no servidor e o cliente usa a do aparelho (ou o voice
gateway auto-hospedado com Kokoro). O texto chega já limpo para fala e é limpo
de novo aqui; nada é guardado.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

from kazer.security.secrets import EnvironmentSecretProvider, SecretNotConfiguredError
from kazer.voice.speech_text import speakable

logger = logging.getLogger("kazer.voice")

MAX_TTS_CHARS = 600  # uma ou duas frases por pedido: começa a tocar rápido
TIMEOUT = httpx.Timeout(20.0, connect=5.0)

ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # voz pronta da biblioteca padrão
ELEVEN_MODEL = "eleven_flash_v2_5"
OPENAI_MODEL = "gpt-4o-mini-tts"
OPENAI_DEFAULT_VOICE = "coral"
OPENAI_INSTRUCTIONS = (
    "Fale em português do Brasil, com sotaque brasileiro natural, tom caloroso e"
    " conversado, ritmo de uma conversa de verdade (nem lento, nem corrido)."
)


class TTSError(Exception):
    """Falha ao gerar a voz (o cliente cai para a voz do aparelho)."""


@dataclass(frozen=True)
class TTSConfig:
    provider: str  # "elevenlabs" | "openai"
    key: str
    voice: str


def _secret(name: str) -> str:
    try:
        return EnvironmentSecretProvider().get_secret(name, scope="voice")
    except SecretNotConfiguredError:
        return ""


def load_config(env: dict[str, str] | None = None) -> TTSConfig | None:
    env = dict(os.environ if env is None else env)
    wanted = env.get("KAZER_TTS_PROVIDER", "").strip().lower()
    voice = env.get("KAZER_TTS_VOICE", "").strip()
    eleven, openai = _secret("ELEVENLABS_API_KEY"), _secret("OPENAI_API_KEY")
    if wanted in ("", "elevenlabs") and eleven:
        return TTSConfig("elevenlabs", eleven, voice or ELEVEN_DEFAULT_VOICE)
    if wanted in ("", "openai") and openai:
        return TTSConfig("openai", openai, voice or OPENAI_DEFAULT_VOICE)
    return None


def synthesize(config: TTSConfig, text: str, client: httpx.Client | None = None) -> bytes:
    """Gera MP3 para um trecho curto. Lança TTSError em qualquer falha."""
    clean = speakable(text)[:MAX_TTS_CHARS].strip()
    if not clean:
        raise TTSError("empty")
    own = client is None
    http = client or httpx.Client(timeout=TIMEOUT)
    try:
        if config.provider == "elevenlabs":
            response = http.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{config.voice}",
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": config.key, "Accept": "audio/mpeg"},
                json={
                    "text": clean,
                    "model_id": ELEVEN_MODEL,
                    "language_code": "pt",
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2},
                },
            )
        else:
            response = http.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {config.key}"},
                json={
                    "model": OPENAI_MODEL,
                    "voice": config.voice,
                    "input": clean,
                    "instructions": OPENAI_INSTRUCTIONS,
                    "response_format": "mp3",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("voice.tts_network: %s", type(exc).__name__)
        raise TTSError("network") from None
    finally:
        if own:
            http.close()
    if response.status_code != 200 or not response.content:
        # Só o código de status: nunca o corpo (pode ecoar o texto da pessoa).
        logger.warning("voice.tts_failed: %s %s", config.provider, response.status_code)
        raise TTSError(str(response.status_code))
    return response.content
