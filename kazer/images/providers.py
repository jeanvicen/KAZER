"""Adaptadores de geração de imagem.

O KAZER não embute modelo nenhum: gerar imagem precisa de GPU, e GPU custa.
Aqui fica só a fronteira. Três estados possíveis:

- **sem provedor** (padrão): `load()` devolve None e a tela diz que a criação de
  imagens ainda não está ligada. Nada é inventado.
- **`endpoint`**: um servidor de inferência **seu** (Diffusers, ComfyUI atrás de um
  adaptador, stable-diffusion.cpp…), descrito em `docs/images/RUNTIME.md`.
  `KAZER_IMAGE_ENDPOINT_URL` (https) e, opcional, `KAZER_IMAGE_ENDPOINT_TOKEN`.
- **`pollinations`**: o serviço aberto da Pollinations (https://pollinations.ai).
  Sem chave usa a API clássica gratuita (limitada por IP, com um selo pequeno no
  canto e no máximo ~768×768); com `KAZER_POLLINATIONS_KEY` usa a API com conta,
  sem selo nem limite por IP. Só é ligado de propósito: o pedido sai do KAZER.
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
import time
import zlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote, urlsplit

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
        return _download("POST", self._url, timeout=self._timeout, json=body, headers=headers)


def _download(
    method: str, url: str, *, timeout: float, retries: int = 0, **kwargs: object
) -> Generated:
    """Baixa a imagem com teto de tamanho e confere o tipo pelos bytes.

    `retries` repete só a recusa passageira (503) do serviço, com pausa curta.
    """
    for attempt in range(retries + 1):
        try:
            return _fetch(method, url, timeout=timeout, **kwargs)
        except _Unavailable:
            if attempt == retries:
                raise ImageError("image_busy") from None
            time.sleep(2.0 * (attempt + 1))
    raise ImageError("image_busy")


class _Unavailable(Exception):
    """O serviço respondeu 503: vale tentar de novo em instantes."""


def _fetch(method: str, url: str, *, timeout: float, **kwargs: object) -> Generated:
    try:
        with httpx.stream(
            method, url, timeout=timeout, follow_redirects=False, **kwargs
        ) as response:
            if response.status_code == 503:
                raise _Unavailable
            if response.status_code in (402, 429):
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


def fit_area(width: int, height: int, max_area: int) -> tuple[int, int]:
    """Reduz mantendo a proporção até caber na área (múltiplos de 8)."""
    if width * height <= max_area:
        return width, height
    scale = (max_area / (width * height)) ** 0.5
    return max(64, int(width * scale) // 8 * 8), max(64, int(height * scale) // 8 * 8)


class PollinationsProvider:
    """Pollinations: grátis sem chave (limitado) ou com chave da conta."""

    name = "pollinations"
    FREE_URL = "https://image.pollinations.ai/prompt/"
    KEY_URL = "https://gen.pollinations.ai/image/"
    FREE_AREA = 768 * 768

    def __init__(
        self, token: str = "", timeout: float = DEFAULT_TIMEOUT, model: str = "flux"
    ) -> None:
        self._token = token
        self._timeout = timeout
        self._model = model or "flux"
        self.label = "Pollinations" if token else "Pollinations (gratuito)"

    def request(self, prompt: str, width: int, height: int, seed: int) -> tuple[str, dict, dict]:
        """URL, parâmetros e cabeçalhos do pedido (separado para testar sem rede)."""
        text = quote(prompt.strip()[:1500], safe="")
        # A Pollinations recusa (400) semente fora de um inteiro de 32 bits com sinal.
        params: dict[str, str | int] = {
            "seed": seed % 2_147_483_647,
            "safe": "true",
            "private": "true",
        }
        headers = {"Accept": "image/*"}
        if self._token:
            params.update(
                {"width": width, "height": height, "model": self._model, "nologo": "true"}
            )
            headers["Authorization"] = f"Bearer {self._token}"
            return self.KEY_URL + text, params, headers
        w, h = fit_area(width, height, self.FREE_AREA)
        params.update({"width": w, "height": h})
        return self.FREE_URL + text, params, headers

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated:
        url, params, headers = self.request(prompt, width, height, seed)
        return _download(
            "GET", url, timeout=self._timeout, retries=1, params=params, headers=headers
        )


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
    try:
        timeout = float(source.get("KAZER_IMAGE_TIMEOUT", DEFAULT_TIMEOUT))
    except ValueError:
        timeout = DEFAULT_TIMEOUT
    timeout = min(max(timeout, 5.0), 280.0)
    if choice == "demo":
        return None if production else DemoProvider()
    if choice == "pollinations":
        try:
            token = get_secret("KAZER_POLLINATIONS_KEY", scope="images")
        except (SecretNotConfiguredError, LookupError, PermissionError):
            token = ""
        model = source.get("KAZER_POLLINATIONS_MODEL", "flux").strip()
        return PollinationsProvider(token, timeout, model)
    if choice in ("", "endpoint") and url:
        parts = urlsplit(url)
        local = parts.hostname in ("localhost", "127.0.0.1")
        if parts.scheme != "https" and not (parts.scheme == "http" and local and not production):
            return None
        try:
            token = get_secret("KAZER_IMAGE_ENDPOINT_TOKEN", scope="images")
        except (SecretNotConfiguredError, LookupError, PermissionError):
            token = ""
        return EndpointProvider(url, token, timeout)
    return None
