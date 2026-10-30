"""Como o KAZER aparece no terminal: a marca, a cor e a resposta ao vivo.

A marca é a Fenda de `docs/brand.md` — um losango partido por um cursor
vertical, metades deslocadas em sentidos opostos — construída aqui pela mesma
geometria, em blocos. Ela funciona em preto e branco, como manda a marca, e
desaparece inteira em terminal que não fala UTF-8.

Cor é enfeite, nunca informação: tudo continua legível com `NO_COLOR=1`, sem
TTY (`kazer "pergunta" > arquivo.txt`) ou em terminal sem cor.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterable

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
# A marca é monocromática por decisão de marca; a cor serve só para hierarquia.
BRIGHT = "\033[97m"
ACCENT = "\033[38;5;110m"
WARN = "\033[38;5;215m"
BAD = "\033[38;5;203m"

# Geometria da Fenda (viewBox 64 × 64): metade esquerda apontando para fora,
# metade direita espelhada e deslocada uma linha abaixo.
_HALF = (1, 2, 3, 4, 3, 2, 1)
_SLIT = "│"
_BLOCK = "█"


def _isatty(stream: object) -> bool:
    """O canal é um terminal de verdade? (arquivo e cano não são)."""
    checker = getattr(stream, "isatty", None)
    try:
        return bool(callable(checker) and checker())
    except ValueError:  # canal já fechado
        return False


def colors_on(stream: object = None) -> bool:
    """Cor só quando há terminal de verdade e ninguém pediu para desligar."""
    if os.environ.get("NO_COLOR", "").strip():
        return False
    if os.environ.get("TERM", "").strip().lower() == "dumb":
        return False
    return _isatty(stream if stream is not None else sys.stdout)


def unicode_on(stream: object = None) -> bool:
    """O terminal aguenta os blocos da marca?"""
    target = stream if stream is not None else sys.stdout
    encoding = str(getattr(target, "encoding", "") or "").lower()
    return "utf" in encoding


def mark() -> list[str]:
    """A Fenda em blocos: duas metades deslocadas, cortadas pelo cursor.

    A metade esquerda é ancorada à direita (cresce em direção à fenda) e a
    direita à esquerda, uma linha abaixo — é o deslocamento de ±4,5 da marca,
    exagerado para uma linha porque em sete linhas de terminal meia linha não
    apareceria.
    """
    width = max(_HALF)
    rows: list[str] = []
    for index in range(len(_HALF) + 1):
        left = _BLOCK * _HALF[index] if index < len(_HALF) else ""
        right = _BLOCK * _HALF[index - 1] if index > 0 else ""
        rows.append(f"{left.rjust(width)}{_SLIT}{right.ljust(width)}")
    return rows


class Screen:
    """Saída do terminal com cor opcional; toda escrita passa por aqui."""

    def __init__(
        self,
        color: bool | None = None,
        unicode: bool | None = None,
        bare: bool | None = None,
    ) -> None:
        """`bare`: saída indo para arquivo ou cano, então a resposta sai limpa.

        `kazer "pergunta" > resposta.txt` tem de produzir a resposta, e não
        moldura: sem prefixo, sem recuo, sem enfeite. Os três são explícitos
        só em teste; na vida real, detecta.
        """
        self.color = colors_on() if color is None else color
        self.unicode = unicode_on() if unicode is None else unicode
        self.bare = (not _isatty(sys.stdout)) if bare is None else bare

    def paint(self, text: str, *codes: str) -> str:
        """Texto com os códigos pedidos, ou cru quando não há cor."""
        if not self.color or not codes:
            return text
        return f"{''.join(codes)}{text}{RESET}"

    def write(self, text: str = "") -> None:
        """Escreve uma linha."""
        sys.stdout.write(text + "\n")
        sys.stdout.flush()

    def chunk(self, text: str) -> None:
        """Escreve um pedaço sem quebrar linha (a resposta chegando)."""
        sys.stdout.write(text)
        sys.stdout.flush()

    def note(self, text: str) -> None:
        """Aviso discreto do próprio terminal, nunca confundido com a resposta."""
        self.write(self.paint(text, DIM))

    def warn(self, text: str) -> None:
        """Algo não saiu como esperado, mas dá para seguir."""
        self.write(self.paint(text, WARN))

    def fail(self, text: str) -> None:
        """Erro: vai para a saída de erro, para não sujar um redirecionamento."""
        sys.stderr.write((self.paint(text, BAD) if self.color else text) + "\n")
        sys.stderr.flush()

    def banner(self, lines: Iterable[str] = ()) -> None:
        """A marca e as linhas de apresentação."""
        if self.unicode:
            self.write()
            for row in mark():
                self.write("  " + self.paint(row, BRIGHT, BOLD))
        self.write()
        self.write("  " + self.paint("KAZER", BOLD) + self.paint(" no terminal", DIM))
        for line in lines:
            self.write("  " + self.paint(line, DIM))
        self.write()
