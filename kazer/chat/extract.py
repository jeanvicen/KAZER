"""Texto de anexos que o modelo não lê direto: PDF, Word, Excel e PowerPoint.

Quando o provedor não aceita documentos (a Groq, por exemplo), o KAZER extrai o
texto aqui e entrega ao modelo como texto do anexo. Tudo em memória, com limite
de tamanho; o arquivo original continua guardado e visível para a pessoa.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from html import unescape

logger = logging.getLogger("kazer.extract")

MAX_CHARS = 60_000
MAX_PAGES = 200
_TAGS = re.compile(r"<[^>]+>")

OFFICE = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def office_kind(data: bytes) -> str | None:
    """docx, xlsx ou pptx pelo conteúdo do zip (nunca pelo nome)."""
    if not data.startswith(b"PK\x03\x04"):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile:
        return None
    if "[Content_Types].xml" not in names:
        return None
    if "word/document.xml" in names:
        return "docx"
    if "xl/workbook.xml" in names:
        return "xlsx"
    if "ppt/presentation.xml" in names:
        return "pptx"
    return None


def _clip(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS] + "\n[conteúdo cortado: arquivo longo]"
    return text


def _read(archive: zipfile.ZipFile, name: str, limit: int = 8_000_000) -> str:
    info = archive.getinfo(name)
    if info.file_size > limit:  # zip-bomba: não descompacta o que é grande demais
        return ""
    return archive.read(name).decode("utf-8", "replace")


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for number, page in enumerate(reader.pages[:MAX_PAGES], 1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append(f"[página {number}]\n{text}")
            if sum(len(p) for p in pages) > MAX_CHARS:
                break
    except Exception:  # noqa: BLE001 - PDF quebrado ou protegido
        logger.info("extract.pdf_failed")
        return ""
    return _clip("\n\n".join(pages))


def docx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = _read(archive, "word/document.xml")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    return _clip(unescape(_TAGS.sub("", xml)))


def pptx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        slides = sorted(
            (n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda name: int(re.findall(r"\d+", name)[-1]),
        )
        parts = []
        for number, name in enumerate(slides, 1):
            texts = re.findall(r"<a:t>(.*?)</a:t>", _read(archive, name), re.S)
            if texts:
                parts.append(f"[slide {number}]\n" + "\n".join(unescape(t) for t in texts))
    return _clip("\n\n".join(parts))


def xlsx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            for item in re.findall(r"<si>(.*?)</si>", _read(archive, "xl/sharedStrings.xml"), re.S):
                shared.append(unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", item, re.S))))
        sheets = sorted(
            (n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
            key=lambda name: int(re.findall(r"\d+", name)[-1]),
        )
        out = []
        for number, name in enumerate(sheets, 1):
            rows = []
            for row in re.findall(r"<row[^>]*>(.*?)</row>", _read(archive, name), re.S)[:2000]:
                cells = []
                for attrs, body in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
                    value = re.search(r"<v>(.*?)</v>", body, re.S)
                    inline = re.search(r"<t[^>]*>(.*?)</t>", body, re.S)
                    if 't="s"' in attrs and value and value.group(1).isdigit():
                        index = int(value.group(1))
                        cells.append(shared[index] if index < len(shared) else "")
                    elif inline:
                        cells.append(unescape(inline.group(1)))
                    elif value:
                        cells.append(unescape(value.group(1)))
                    else:
                        cells.append("")
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                out.append(f"[planilha {number}]\n" + "\n".join(rows))
    return _clip("\n\n".join(out))


def text_of(kind: str, name: str, data: bytes) -> str:
    """Texto legível de um anexo pdf/docx/xlsx/pptx ('' se não der)."""
    try:
        if kind == "pdf":
            return pdf_text(data)
        office = office_kind(data)
        if office == "docx":
            return docx_text(data)
        if office == "xlsx":
            return xlsx_text(data)
        if office == "pptx":
            return pptx_text(data)
    except (zipfile.BadZipFile, KeyError, ValueError):
        logger.info("extract.failed", extra={"kind": kind})
    return ""
