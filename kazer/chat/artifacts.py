"""Artefatos: os blocos que valem ser guardados fora da conversa.

Quando o KAZER devolve uma página inteira, um componente, um SVG, um diagrama
ou um arquivo de dados, esse pedaço vira um artefato: fica na Biblioteca, abre
num painel próprio e pode ser copiado ou baixado sem rolar a conversa toda.

A detecção é do servidor e não depende de ferramenta do provedor: funciona com
qualquer modelo configurado. Só blocos cercados (```) entram, e só acima de um
tamanho mínimo — trecho curto continua sendo trecho de código na conversa, não
artefato.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Abaixo disto é trecho de exemplo, não entrega: não vira artefato.
MIN_CHARS = 400
MAX_CHARS = 400_000
MAX_PER_REPLY = 4
MAX_TITLE = 200

# ```lang título opcional\n...conteúdo...\n```
_FENCE = re.compile(
    r"^[ \t]*(?P<fence>`{3,}|~{3,})[ \t]*(?P<info>[^\n]*)\n(?P<body>.*?)^[ \t]*(?P=fence)[ \t]*$",
    re.DOTALL | re.MULTILINE,
)

# Linguagem -> tipo do artefato. O que não estiver aqui vira "code".
_KINDS: dict[str, str] = {
    "svg": "image",
    "mermaid": "diagram",
    "dot": "diagram",
    "graphviz": "diagram",
    "json": "data",
    "csv": "data",
    "yaml": "data",
    "yml": "data",
    "toml": "data",
    "sql": "data",
    "md": "document",
    "markdown": "document",
    "tex": "document",
    "latex": "document",
}

# Rótulo humano por linguagem, para o título quando não há um melhor.
_LABELS: dict[str, str] = {
    "html": "Página HTML",
    "svg": "Imagem SVG",
    "mermaid": "Diagrama",
    "css": "Folha de estilo",
    "js": "Script JavaScript",
    "javascript": "Script JavaScript",
    "jsx": "Componente React",
    "tsx": "Componente React",
    "ts": "Script TypeScript",
    "typescript": "Script TypeScript",
    "python": "Script Python",
    "py": "Script Python",
    "sql": "Consulta SQL",
    "json": "Dados JSON",
    "csv": "Planilha CSV",
    "yaml": "Configuração YAML",
    "markdown": "Documento",
    "md": "Documento",
    "sh": "Script de terminal",
    "bash": "Script de terminal",
}


@dataclass(frozen=True, slots=True)
class Draft:
    """Artefato encontrado numa resposta, antes de virar linha no banco."""

    kind: str
    title: str
    language: str
    content: str


def _title_from(info: str, language: str, before: str) -> str:
    """Título: o que veio na cerca, senão a frase antes do bloco, senão o rótulo."""
    # ```html minha-pagina.html  ->  "minha-pagina.html"
    rest = info.split(None, 1)[1].strip() if len(info.split(None, 1)) > 1 else ""
    if rest:
        return rest[:MAX_TITLE]

    # A última linha de texto antes do bloco costuma apresentar o que vem nele.
    for line in reversed(before.strip().splitlines()):
        clean = line.strip().lstrip("#").strip().rstrip(":").strip()
        clean = re.sub(r"[*_`]", "", clean)
        if 3 <= len(clean) <= MAX_TITLE and not clean.startswith(("|", ">", "-", "1.")):
            return clean

    return _LABELS.get(language, "Arquivo")


def extract(content: str) -> list[Draft]:
    """Artefatos de uma resposta, na ordem em que aparecem.

    Blocos curtos, vazios ou grandes demais ficam de fora. No máximo quatro por
    resposta: além disso é conversa cheia de exemplos, não entrega.
    """
    found: list[Draft] = []
    for match in _FENCE.finditer(content):
        body = match.group("body").strip("\n")
        if not (MIN_CHARS <= len(body) <= MAX_CHARS):
            continue
        info = match.group("info").strip()
        language = (info.split(None, 1)[0] if info else "").lower()
        # Uma cerca sem linguagem costuma ser saída de terminal colada.
        if not language:
            continue
        found.append(
            Draft(
                kind=_KINDS.get(language, "code"),
                title=_title_from(info, language, content[: match.start()]),
                language=language,
                content=body,
            )
        )
        if len(found) == MAX_PER_REPLY:
            break
    return found
