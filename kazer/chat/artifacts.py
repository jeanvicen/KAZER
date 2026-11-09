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


_MENTIONED = re.compile(r"`?([\w.-]{1,80}\.[A-Za-z0-9]{1,8})`?")


def _title_from(info: str, language: str, before: str) -> str:
    """Nome do arquivo na cerca; senão o último nome de arquivo citado logo antes;
    senão um rótulo pelo tipo. Frases soltas ("Ele contém:") nunca viram título."""
    title = _explicit_title(info)
    if title:
        return title
    recent = before[-400:]
    named = [
        name for name in _MENTIONED.findall(recent)
        if name.rsplit(".", 1)[-1].lower() in _EXTENSIONS
    ]
    if named:
        return named[-1]
    for line in reversed(recent.strip().splitlines()[-3:]):
        clean = line.strip()
        if clean.startswith("#"):
            clean = re.sub(r"[*_`]", "", clean.lstrip("#")).strip().rstrip(":").strip()
            if 3 <= len(clean) <= MAX_TITLE:
                return clean
    return _LABELS.get(language, "Arquivo")


_EXTENSIONS = frozenset(
    "html htm css js jsx ts tsx py json md txt csv sql sh yaml yml toml xml svg java c cpp h"
    " cs go rs rb php kt swift dart lua gd tscn godot vue".split()
)


# Artefato só existe quando a pessoa PEDE uma entrega: "crie um site", "gera um
# PDF", "faz uma apresentação", "me manda o arquivo", "salva em .html". Pergunta
# de como fazer ("como criar jogos passo a passo") ou conversa comum não gera
# nada, mesmo que a resposta traga exemplos de código.
_ASK = re.compile(
    r"\b(?:crie|cria|criar\s+(?:pra|para)\s+mim|gere|gera|fa[çc]a|faz|monte|monta|escreva|"
    r"escreve|desenvolva|desenvolve|programe|programa\s+(?:um|uma)|construa|constr[óo]i|"
    r"elabore|elabora|prepare|prepara|produza|desenhe|desenha|me\s+(?:d[êe]|manda|mande|"
    r"envia|envie|passa|passe)|manda|mande|quero\s+(?:um|uma|o|a)|preciso\s+de\s+(?:um|uma)|"
    r"me\s+ajuda\s+a\s+(?:criar|fazer|montar|escrever|programar|desenvolver)|transforma|"
    r"transforme|converte|converta|exporta|exporte|salva|salve|baixar|download|refa[çz]a?|"
    r"corrige|corrija|ajusta|ajuste|muda|mude|melhora|melhore|atualiza|atualize|"
    r"create|make|build|write|generate|draft|design|export|convert|send\s+me|give\s+me)\b",
    re.IGNORECASE,
)
_THING = re.compile(
    r"\b(?:arquivos?|slides?|apresenta[çc][ãa]o|apresenta[çc][õo]es|pdf|planilha|documento|"
    r"relat[óo]rio|site|p[áa]gina|landing|html|c[óo]digo|script|programa|app|aplicativo|"
    r"jogo|game|projeto|svg|diagrama|fluxograma|imagem|imagens|foto|fotos|logo|[íi]cone|"
    r"csv|json|yaml|config(?:ura[çc][ãa]o)?|componente|template|modelo\s+de|curr[íi]culo|"
    r"contrato|e-?book|tabela|gr[áa]fico|zip|file|files|slide\s*deck|deck|website|webpage|"
    r"page|spreadsheet|document|report|image|diagram|component|project|"
    # Continuação de uma entrega: "faz outra", "mais uma versão", "de novo".
    r"outr[oa]s?|mais\s+uma?|de\s+novo|novamente|vers[ãa]o|another|again)\b",
    re.IGNORECASE,
)
_HOW = re.compile(r"^\s*(?:como|what|how|o\s+que|qual|quais|por\s*que|why)\b", re.IGNORECASE)
_FILE_MENTION = re.compile(r"\b[\w-]{1,60}\.(?:" + "|".join(sorted(
    "html htm css js jsx ts tsx py json md txt csv sql sh yaml yml toml xml svg java c cpp cs go "
    "rs rb php kt swift dart lua gd pdf docx xlsx pptx zip".split()
)) + r")\b", re.IGNORECASE)


# Revisão de uma entrega anterior: basta o verbo ("refaz com fundo azul").
_REVISE = re.compile(
    r"\b(?:refa[çz]a?|refaz|corrige|corrija|ajusta|ajuste|muda|mude|melhora|melhore|atualiza|"
    r"atualize|troca|troque)\b|^\s*(?:mais\s+uma|outra)\s+vers[ãa]o",
    re.IGNORECASE,
)
_DIRECT = re.compile(r"\b(?:crie|gere|fa[çc]a|monte|me\s+(?:d[êe]|manda))\b", re.IGNORECASE)


def wants_deliverable(question: str) -> bool:
    """A mensagem pede uma entrega (arquivo, slide, site...) e não só uma explicação?"""
    text = question or ""
    if _FILE_MENTION.search(text) or _REVISE.search(text):
        return True
    if not (_ASK.search(text) and _THING.search(text)):
        return False
    # "Como criar um site?" é pergunta de como fazer; "como" + pedido direto
    # ("como faço... crie pra mim") ainda passa pelo verbo no imperativo.
    if _HOW.match(text) and not _DIRECT.search(text):
        return False
    return True


def extract(content: str, question: str | None = None) -> list[Draft]:
    """Extrai entregáveis com prévia, só quando a pessoa pediu uma entrega.

    `question` None mantém o comportamento antigo (usado só por ferramentas internas).
    """
    if question is not None and not wants_deliverable(question):
        return []
    found: list[Draft] = []
    for match in _FENCE.finditer(content):
        body = match.group("body").strip("\n")
        info = match.group("info").strip()
        language = (info.split(None, 1)[0] if info else "").lower()
        title = _title_from(info, language, content[: match.start()])
        explicitly_named = bool(_FILENAME.fullmatch(_explicit_title(info)))
        if not language or not body or len(body) > MAX_CHARS or language.startswith("kazer-"):
            continue
        if len(body) < MIN_CHARS and not explicitly_named:
            continue
        kind = _KINDS.get(language, "code")
        found.append(Draft(kind=kind, title=title, language=language, content=body))
        if len(found) == MAX_PER_REPLY:
            break
    return found
