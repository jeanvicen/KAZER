"""Validação e armazenamento privado de anexos.

O tipo declarado pelo navegador não é confiável: o servidor identifica o conteúdo
pelos primeiros bytes (imagens e PDF) ou exige UTF-8 sem bytes nulos (texto).
Os arquivos ficam fora da pasta pública, num diretório por conta (0700) e com
permissão 0600; o nome no disco é o identificador aleatório, nunca o nome original.
"""

from __future__ import annotations

import os
import re
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TEXT_BYTES = 1024 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_UPLOAD_BYTES = max(MAX_IMAGE_BYTES, MAX_TEXT_BYTES, MAX_PDF_BYTES)
MAX_STORAGE_PER_USER = 200 * 1024 * 1024
MAX_PENDING_PER_USER = 20
MAX_NAME_LENGTH = 120

TEXT_EXTENSIONS = frozenset(
    {
        "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "toml",
        "ini", "cfg", "log", "html", "htm", "css", "scss", "js", "mjs", "cjs", "ts", "tsx",
        "jsx", "py", "rb", "php", "java", "kt", "kts", "swift", "go", "rs", "c", "h", "cc",
        "cpp", "hpp", "cs", "sql", "sh", "bash", "zsh", "ps1", "r", "lua", "dart", "vue",
        "svelte", "tex", "srt", "vtt",
    }
)

_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class UploadRejected(Exception):
    """Anexo recusado; `code` é estável e não revela detalhes internos."""

    def __init__(self, code: str, status: int) -> None:
        """`code`: attachment_type, attachment_too_large ou attachment_empty."""
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True, slots=True)
class Detected:
    """Resultado da inspeção do conteúdo."""

    kind: str
    media_type: str


def valid_id(value: str) -> bool:
    """Identificadores gerados pelo servidor: nada de caminhos ou pontos."""
    return bool(_ID.match(value))


def clean_name(raw: str) -> str:
    """Nome só para exibição: sem diretórios, controles ou bidi; tamanho limitado."""
    name = raw.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(
        char for char in unicodedata.normalize("NFC", name)
        if unicodedata.category(char)[0] != "C"
    ).strip(" .")
    if not name:
        name = "arquivo"
    if len(name) > MAX_NAME_LENGTH:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: MAX_NAME_LENGTH - len(ext) - 2] + "…." + ext) if dot and len(ext) < 12 \
            else name[:MAX_NAME_LENGTH]
    return name


def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def detect(data: bytes, name: str) -> Detected:
    """Identifica o anexo pelo conteúdo real; recusa o que não for suportado."""
    if not data:
        raise UploadRejected("attachment_empty", 400)
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = Detected("image", "image/png")
    elif data.startswith(b"\xff\xd8\xff"):
        detected = Detected("image", "image/jpeg")
    elif data[:6] in (b"GIF87a", b"GIF89a"):
        detected = Detected("image", "image/gif")
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        detected = Detected("image", "image/webp")
    elif data.startswith(b"%PDF-"):
        detected = Detected("pdf", "application/pdf")
    else:
        if _extension(name) not in TEXT_EXTENSIONS or b"\x00" in data:
            raise UploadRejected("attachment_type", 415)
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise UploadRejected("attachment_type", 415) from None
        detected = Detected("text", "text/plain")

    limit = {"image": MAX_IMAGE_BYTES, "pdf": MAX_PDF_BYTES, "text": MAX_TEXT_BYTES}[detected.kind]
    if len(data) > limit:
        raise UploadRejected("attachment_too_large", 413)
    return detected


class UploadStorage:
    """Disco privado; todo acesso passa por identificadores validados."""

    def __init__(self, root: Path) -> None:
        """Nada é criado até o primeiro anexo."""
        self._root = root

    def _path(self, user_id: str, attachment_id: str) -> Path:
        if not (valid_id(attachment_id) and re.fullmatch(r"[0-9a-f]{32}", user_id)):
            raise ValueError("identificador inválido")
        return self._root / user_id / attachment_id

    def save(self, user_id: str, attachment_id: str, data: bytes) -> None:
        """Grava atomicamente com permissões restritas."""
        path = self._path(user_id, attachment_id)
        self._root.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.parent.mkdir(exist_ok=True, mode=0o700)
        temporary = path.with_name(path.name + ".part")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(temporary, path)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise

    def read(self, user_id: str, attachment_id: str) -> bytes | None:
        """Conteúdo do anexo ou None se o arquivo sumiu."""
        try:
            return self._path(user_id, attachment_id).read_bytes()
        except (FileNotFoundError, ValueError):
            return None

    def delete(self, user_id: str, attachment_id: str) -> None:
        """Remove o arquivo (ignora o que já não existe)."""
        try:
            self._path(user_id, attachment_id).unlink(missing_ok=True)
        except ValueError:
            pass

    def delete_user(self, user_id: str) -> None:
        """Apaga todos os anexos de uma conta excluída."""
        if re.fullmatch(r"[0-9a-f]{32}", user_id):
            shutil.rmtree(self._root / user_id, ignore_errors=True)
