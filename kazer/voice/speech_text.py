"""Texto que dá para falar: tira markdown, código, links e citações.

A mesma regra existe no cliente (assets/voicemode.js); o gateway aplica de novo
porque nunca confia no que chega.
"""

from __future__ import annotations

import json
import re

MAX_SPEAK_CHARS = 4000

_FENCE = re.compile(r"```([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)")
_URL = re.compile(r"https?://\S+")
_CITE = re.compile(r"\[(?:\d+|foto \d+)\](?:\[\d+\])*")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_SYMBOLS = re.compile(r"[*_`#>|~]+")
_SPACES = re.compile(r"[ \t]+")
_SENTENCE = re.compile(r"(?<=[.!?…])\s+|\n+")


def _fence(match: re.Match[str]) -> str:
    lang, body = match.group(1), match.group(2)
    if lang == "kazer-pergunta":
        try:
            data = json.loads(body)
        except ValueError:
            return ""
        question = str(data.get("pergunta") or data.get("question") or "")
        options = data.get("opcoes") or data.get("options") or []
        names = [
            str(item.get("texto") or item.get("text") or "")
            if isinstance(item, dict)
            else str(item)
            for item in options
        ]
        names = [name for name in names if name]
        if not question:
            return ""
        return f" {question} " + (" Opções: " + ", ".join(names) + ". " if names else "")
    return " (o código está na tela) "


def speakable(text: str) -> str:
    """Versão falável e limpa; vazio quando não sobra nada para dizer."""
    out = _FENCE.sub(_fence, str(text or ""))
    out = _MD_LINK.sub(r"\1", out)
    out = _URL.sub("", out)
    out = _CITE.sub("", out)
    out = re.sub(r"^\s*[-*+]\s+", "", out, flags=re.M)
    out = re.sub(r"^\s*\d+[.)]\s+", "", out, flags=re.M)
    out = _SYMBOLS.sub("", out)
    out = _SPACES.sub(" ", out)
    out = re.sub(r"\n{2,}", "\n", out).strip()
    return out[:MAX_SPEAK_CHARS]


def sentences(text: str) -> list[str]:
    """Frases para sintetizar uma a uma (a primeira toca antes de a última ficar pronta)."""
    parts = [part.strip() for part in _SENTENCE.split(text) if part and part.strip()]
    merged: list[str] = []
    for part in parts:
        # Frases curtíssimas ("Sim.") juntam com a próxima: soa menos picado.
        if merged and len(merged[-1]) < 24:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return merged
