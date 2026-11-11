"""Adaptadores de geração de imagem.

O KAZER não embute modelo nenhum: gerar imagem precisa de GPU, e GPU custa.
Aqui fica só a fronteira. Três estados possíveis:

- **sem provedor** (padrão): `load()` devolve None e a tela diz que a criação de
  imagens ainda não está ligada. Nada é inventado.
- **`endpoint`**: um servidor de inferência **seu** (Diffusers, ComfyUI atrás de um
  adaptador, stable-diffusion.cpp…), descrito em `docs/images/RUNTIME.md`.
  `KAZER_IMAGE_ENDPOINT_URL` (https) e, opcional, `KAZER_IMAGE_ENDPOINT_TOKEN`.
- **`demo`**: desenha um degradê com o texto do pedido embutido nos metadados.
  Só fora de produção, para testar a cota e a tela sem GPU. Nunca é apresentado
  como imagem de IA.

O contrato do endpoint é pequeno de propósito:

    POST <url>   Authorization: Bearer <token>
    {"prompt": "...", "width": 1024, "height": 1024, "seed": 123}
    → 200 image/png | image/jpeg | image/webp   (os bytes da imagem)
"""

from __future__ import annotations

import os
import struct
import zlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from kazer.security.secrets import SecretNotConfiguredError, get_secret

MAX_IMAGE_BYTES = 12 * 1024 * 1024
DEFAULT_TIMEOUT = 90.0
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


class ImageError(Exception):
    """Falha ao gerar; `code` é estável e não carrega detalhe interno."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class Generated:
    data: bytes
    media_type: str


class ImageProvider(Protocol):
    name: str
    # Rótulo honesto para a tela ("Servidor próprio", "Demonstração").
    label: str

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated: ...


def sniff(data: bytes) -> str | None:
    """Tipo real pelos primeiros bytes (nunca pelo cabeçalho que o servidor mandou)."""
    for signature, media_type in _SIGNATURES:
        if data.startswith(signature):
            return media_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class EndpointProvider:
    """Servidor de inferência próprio, falado por HTTP."""

    name = "endpoint"
    label = "Servidor próprio"

    def __init__(self, url: str, token: str = "", timeout: float = DEFAULT_TIMEOUT) -> None:
        self._url = url
        self._token = token
        self._timeout = timeout

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated:
        headers = {"Accept": "image/*"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        body = {"prompt": prompt, "width": width, "height": height, "seed": seed}
        try:
            with httpx.stream(
                "POST",
                self._url,
                json=body,
                headers=headers,
                timeout=self._timeout,
                follow_redirects=False,
            ) as response:
                if response.status_code in (429, 503):
                    raise ImageError("image_busy")
                if response.status_code != 200:
                    raise ImageError("image_failed")
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise ImageError("image_too_large")
                    chunks.append(chunk)
        except httpx.TimeoutException:
            raise ImageError("image_timeout") from None
        except httpx.HTTPError:
            raise ImageError("image_failed") from None
        data = b"".join(chunks)
        media_type = sniff(data)
        if media_type is None:
            raise ImageError("image_invalid")
        return Generated(data, media_type)


def _png(width: int, height: int, rows: list[bytes], text: str) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + row for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"tEXt", b"Comment\x00" + text.encode("latin-1", "replace")[:500])
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


class DemoProvider:
    """Degradê determinístico, sem modelo: só para desenvolvimento e testes."""

    name = "demo"
    label = "Demonstração (sem modelo)"

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated:
        # Pequena de propósito: é um marcador visual, não uma imagem de verdade.
        scale = max(width, height) / 256
        w, h = max(8, round(width / scale)), max(8, round(height / scale))
        base = (20 + seed % 60, 16 + (seed >> 6) % 40, 12 + (seed >> 12) % 30)
        gold = (213, 177, 90)
        rows = []
        for y in range(h):
            row = bytearray()
            for x in range(w):
                t = (x / w * 0.6 + y / h * 0.4) ** 1.6
                row += bytes(round(base[i] + (gold[i] - base[i]) * t) for i in range(3))
            rows.append(bytes(row))
        return Generated(_png(w, h, rows, f"KAZER demo: {prompt}"), "image/png")


def load(env: Mapping[str, str] | None = None, *, production: bool = False) -> ImageProvider | None:
    """Provedor configurado ou None (criação de imagens desligada)."""
    source = os.environ if env is None else env
    choice = source.get("KAZER_IMAGE_PROVIDER", "").strip().lower()
    url = source.get("KAZER_IMAGE_ENDPOINT_URL", "").strip()
    if choice == "demo":
        return None if production else DemoProvider()
    if choice in ("", "endpoint") and url:
        parts = urlsplit(url)
        local = parts.hostname in ("localhost", "127.0.0.1")
        if parts.scheme != "https" and not (parts.scheme == "http" and local and not production):
            return None
        try:
            token = get_secret("KAZER_IMAGE_ENDPOINT_TOKEN", scope="images")
        except (SecretNotConfiguredError, LookupError, PermissionError):
            token = ""
        try:
            timeout = float(source.get("KAZER_IMAGE_TIMEOUT", DEFAULT_TIMEOUT))
        except ValueError:
            timeout = DEFAULT_TIMEOUT
        return EndpointProvider(url, token, min(max(timeout, 5.0), 280.0))
    return None
