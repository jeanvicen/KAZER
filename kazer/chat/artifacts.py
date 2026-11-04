"""Artefatos: entregáveis detectados pelo servidor e disponíveis para prévia."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Trechos grandes viram artefato automaticamente. Um bloco com nome de arquivo
# explícito também vira artefato, mesmo pequeno: quando a pessoa pede um arquivo,
# a entrega não pode desaparecer por causa de um limite visual arbitrário.
MIN_CHARS = 400
MAX_CHARS = 400_000
MAX_PER_REPLY = 4
MAX_TITLE = 200

_FENCE = re.compile(
    r"^[ \t]*(?P<fence>`{3,}|~{3,})[ \t]*(?P<info>[^\n]*)\n(?P<body>.*?)^[ \t]*(?P=fence)[ \t]*$",
    re.DOTALL | re.MULTILINE,
)

_KINDS: dict[str, str] = {
    "svg": "image", "mermaid": "diagram", "dot": "diagram", "graphviz": "diagram",
    "json": "data", "csv": "data", "yaml": "data", "yml": "data", "toml": "data",
    "sql": "data", "md": "document", "markdown": "document", "tex": "document", "latex": "document",
}

_LABELS: dict[str, str] = {
    "html": "Página HTML", "svg": "Imagem SVG", "mermaid": "Diagrama", "css": "Folha de estilo",
    "js": "Script JavaScript", "javascript": "Script JavaScript", "jsx": "Componente React",
    "tsx": "Componente React", "ts": "Script TypeScript", "typescript": "Script TypeScript",
    "python": "Script Python", "py": "Script Python", "sql": "Consulta SQL", "json": "Dados JSON",
    "csv": "Planilha CSV", "yaml": "Configuração YAML", "markdown": "Documento", "md": "Documento",
    "sh": "Script de terminal", "bash": "Script de terminal",
}

# Nome simples de arquivo, sem caminho, evita que texto livre curto vire entrega.
_FILENAME = re.compile(r"^[^/\\\n]{1,180}\.[A-Za-z0-9]{1,12}$")


@dataclass(frozen=True, slots=True)
class Draft:
    kind: str
    title: str
    language: str
    content: str


def _explicit_title(info: str) -> str:
    parts = info.split(None, 1)
    return parts[1].strip().replace("\n", " ")[:MAX_TITLE] if len(parts) > 1 else ""


def _title_from(info: str, language: str, before: str) -> str:
    title = _explicit_title(info)
    if title:
        return title
    for line in reversed(before.strip().splitlines()):
        clean = line.strip().lstrip("#").strip().rstrip(":").strip()
        clean = re.sub(r"[*_`]", "", clean)
        if 3 <= len(clean) <= MAX_TITLE and not clean.startswith(("|", ">", "-", "1.")):
            return clean
    return _LABELS.get(language, "Arquivo")


def extract(content: str) -> list[Draft]:
    """Extrai entregáveis com prévia, sem criar arquivos para exemplos soltos."""
    found: list[Draft] = []
    for match in _FENCE.finditer(content):
        body = match.group("body").strip("\n")
        info = match.group("info").strip()
        language = (info.split(None, 1)[0] if info else "").lower()
        title = _title_from(info, language, content[: match.start()])
        explicitly_named = bool(_FILENAME.fullmatch(_explicit_title(info)))
        if not language or not body or len(body) > MAX_CHARS:
            continue
        if len(body) < MIN_CHARS and not explicitly_named:
            continue
        found.append(Draft(kind=_KINDS.get(language, "code"), title=title, language=language, content=body))
        if len(found) == MAX_PER_REPLY:
            break
    return found
