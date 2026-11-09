"""Voz do KAZER gerada no servidor.

Padrão: **Piper** (open source, roda em CPU dentro do próprio servidor), com uma
voz masculina em português do Brasil (`pt_BR-cadu-medium`; `KAZER_PIPER_VOICE`
troca para `pt_BR-faber-medium`). A voz é baixada uma vez do repositório oficial
`rhasspy/piper-voices` (revisão fixa v1.0.0) e fica em cache.

Opcional, só com `KAZER_TTS_PROVIDER` explícito: ElevenLabs
(`ELEVENLABS_API_KEY`) ou OpenAI (`OPENAI_API_KEY`, `gpt-4o-mini-tts`).
`KAZER_TTS_PROVIDER=none` desliga a voz no servidor.

O texto chega limpo para fala e é limpo de novo aqui; nada é guardado.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import wave
from dataclasses import dataclass
from pathlib import Path

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


PIPER_VOICES = {
    # nome: (pasta no repositório)
    "pt_BR-cadu-medium": "pt/pt_BR/cadu/medium",
    "pt_BR-faber-medium": "pt/pt_BR/faber/medium",
}
PIPER_DEFAULT_VOICE = "pt_BR-cadu-medium"
PIPER_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"
PIPER_MAX_BYTES = 200 * 1024 * 1024
_piper_lock = threading.Lock()
_piper_cache: dict[str, object] = {}


class TTSError(Exception):
    """Falha ao gerar a voz (o cliente cai para a voz do aparelho)."""


@dataclass(frozen=True)
class TTSConfig:
    provider: str  # "piper" | "elevenlabs" | "openai"
    key: str
    voice: str


def _secret(name: str) -> str:
    try:
        return EnvironmentSecretProvider().get_secret(name, scope="voice")
    except SecretNotConfiguredError:
        return ""


def load_config(env: dict[str, str] | None = None) -> TTSConfig | None:
    env = dict(os.environ if env is None else env)
    wanted = env.get("KAZER_TTS_PROVIDER", "").strip().lower() or "piper"
    voice = env.get("KAZER_TTS_VOICE", "").strip()
    if wanted == "none":
        return None
    if wanted == "elevenlabs" and (key := _secret("ELEVENLABS_API_KEY")):
        return TTSConfig("elevenlabs", key, voice or ELEVEN_DEFAULT_VOICE)
    if wanted == "openai" and (key := _secret("OPENAI_API_KEY")):
        return TTSConfig("openai", key, voice or OPENAI_DEFAULT_VOICE)
    piper_voice = env.get("KAZER_PIPER_VOICE", "").strip() or PIPER_DEFAULT_VOICE
    if piper_voice not in PIPER_VOICES:
        piper_voice = PIPER_DEFAULT_VOICE
    return TTSConfig("piper", "", piper_voice)


# ---------- Piper (open source, no próprio servidor) ----------


def _piper_dir() -> Path:
    base = os.environ.get("KAZER_PIPER_DIR", "").strip()
    return Path(base) if base else Path(os.environ.get("TMPDIR", "/tmp")) / "kazer-piper"


def _download(url: str, target: Path, client: httpx.Client) -> None:
    """Baixa com teto de tamanho e grava de forma atômica (sem arquivo pela metade)."""
    partial = target.with_suffix(target.suffix + ".part")
    total = 0
    with client.stream("GET", url, follow_redirects=True) as response:
        if response.status_code != 200:
            raise TTSError(f"download_{response.status_code}")
        with partial.open("wb") as handle:
            for chunk in response.iter_bytes(1 << 20):
                total += len(chunk)
                if total > PIPER_MAX_BYTES:
                    raise TTSError("download_too_large")
                handle.write(chunk)
    partial.replace(target)


def _piper_voice(name: str) -> object:
    """Carrega a voz uma vez por processo (baixa na primeira vez)."""
    with _piper_lock:
        if name in _piper_cache:
            return _piper_cache[name]
        try:
            from piper import PiperVoice  # type: ignore[import-not-found]
        except ImportError:
            raise TTSError("piper_missing") from None
        folder = _piper_dir()
        folder.mkdir(parents=True, exist_ok=True)
        model = folder / f"{name}.onnx"
        config = folder / f"{name}.onnx.json"
        base = os.environ.get("KAZER_PIPER_BASE_URL", "").strip().rstrip("/") or PIPER_BASE_URL
        remote = f"{base}/{PIPER_VOICES[name]}/{name}"
        if not model.exists() or not config.exists():
            with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                try:
                    if not config.exists():
                        _download(f"{remote}.onnx.json", config, client)
                    if not model.exists():
                        _download(f"{remote}.onnx", model, client)
                except httpx.HTTPError as exc:
                    logger.warning("voice.piper_download: %s", type(exc).__name__)
                    raise TTSError("download") from None
        try:
            voice = PiperVoice.load(model, config_path=config)
        except Exception:  # noqa: BLE001 - arquivo ruim: apaga para baixar de novo
            logger.exception("voice.piper_load_failed")
            model.unlink(missing_ok=True)
            config.unlink(missing_ok=True)
            raise TTSError("load") from None
        _piper_cache[name] = voice
        return voice


def _piper_wav(name: str, text: str) -> bytes:
    from piper import SynthesisConfig  # type: ignore[import-not-found]

    voice = _piper_voice(name)
    # Um pouco mais pausado e com variação natural: menos "robô lendo".
    tuning = SynthesisConfig(length_scale=1.05, noise_scale=0.6, noise_w_scale=0.8)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=tuning)  # type: ignore[attr-defined]
    return buffer.getvalue()


def media_type(config: TTSConfig) -> str:
    return "audio/wav" if config.provider == "piper" else "audio/mpeg"


def synthesize(config: TTSConfig, text: str, client: httpx.Client | None = None) -> bytes:
    """Gera o áudio de um trecho curto (WAV no Piper, MP3 nos pagos)."""
    clean = speakable(text)[:MAX_TTS_CHARS].strip()
    if not clean:
        raise TTSError("empty")
    if config.provider == "piper":
        try:
            audio = _piper_wav(config.voice, clean)
        except TTSError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("voice.piper_failed")
            raise TTSError("piper") from None
        if len(audio) <= 44:
            raise TTSError("empty_audio")
        return audio
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
