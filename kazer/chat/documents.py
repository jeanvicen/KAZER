"""PDFs de verdade: documentos (A4) e apresentações (16:9) a partir do Markdown.

O modelo escreve o conteúdo num bloco ```pdf ou ```slides; a interface manda
esse texto para cá e recebe um arquivo .pdf pronto para baixar — sem janela de
impressão e sem código para a pessoa rodar. Tudo é desenhado com fpdf2 e a
fonte Liberation (licença OFL), que cobre acentos, travessões e aspas.

O texto vem do modelo (não confiável), mas aqui ele só vira desenho num PDF:
não há HTML, script nem acesso a arquivos ou à rede.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
MAX_SOURCE = 400_000
_MONTHS = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
           "setembro", "outubro", "novembro", "dezembro")

# Troca de caracteres que a fonte não tem por equivalentes legíveis.
_REPLACE = {"✓": "•", "✔": "•", "✅": "•", "❌": "×", "✗": "×", "→": "->", "⇒": "=>",
            "←": "<-", "★": "*", "⭐": "*", "…": "...", " ": " ", "\t": "    "}


@lru_cache(maxsize=1)
def _glyphs() -> frozenset[int]:
    from fontTools.ttLib import TTFont  # vem junto com o fpdf2

    with TTFont(FONTS / "LiberationSans-Regular.ttf") as font:
        return frozenset(font.getBestCmap().keys())


def clean(text: str) -> str:
    """Só caracteres que a fonte desenha; emoji e símbolos raros somem."""
    for bad, good in _REPLACE.items():
        text = text.replace(bad, good)
    glyphs = _glyphs()
    return "".join(ch for ch in text if ch == "\n" or ord(ch) in glyphs)


def _hex(value: str, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})", (value or "").strip())
    if not match:
        return fallback
    raw = match.group(1)
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)


Color = tuple[int, ...]


def _mix(color: Color, other: Color, amount: float) -> Color:
    return tuple(round(a + (b - a) * amount) for a, b in zip(color, other, strict=True))


def front_matter(source: str) -> tuple[dict[str, str], str]:
    """Cabeçalho `---\\nchave: valor\\n---` no começo; devolve (meta, corpo)."""
    lines = source.replace("\r\n", "\n").split("\n")
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    meta: dict[str, str] = {}
    if start < len(lines) and lines[start].strip() == "---":
        for end in range(start + 1, len(lines)):
            if lines[end].strip() == "---":
                for line in lines[start + 1 : end]:
                    key, _, value = line.partition(":")
                    if value:
                        meta[key.strip().lower()] = value.strip()
                return meta, "\n".join(lines[end + 1 :])
    return meta, source


def split_slides(body: str) -> list[str]:
    slides: list[str] = []
    current: list[str] = []
    fence = False
    for line in body.split("\n"):
        if re.match(r"\s*(```|~~~)", line):
            fence = not fence
        if not fence and re.fullmatch(r"\s*---\s*", line):
            if "".join(current).strip():
                slides.append("\n".join(current))
            current = []
            continue
        current.append(line)
    if "".join(current).strip():
        slides.append("\n".join(current))
    return slides


# ---------------------------------------------------------------------------
# Markdown em blocos
# ---------------------------------------------------------------------------


@dataclass
class Block:
    kind: str  # h1 h2 h3 p ul ol quote code table hr
    text: str = ""
    items: list[str] | None = None
    rows: list[list[str]] | None = None


_ITEM = re.compile(r"^\s*([-*+]|\d{1,3}[.)])\s+(.*)$")


def blocks(markdown: str) -> list[Block]:
    out: list[Block] = []
    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            code: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(marker):
                code.append(lines[i])
                i += 1
            out.append(Block("code", "\n".join(code)))
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*?)\s*#*$", stripped)
        if heading:
            level = min(len(heading.group(1)), 3)
            out.append(Block(f"h{level}", heading.group(2)))
            i += 1
            continue
        if re.fullmatch(r"([-*_])(\s*\1){2,}", stripped):
            out.append(Block("hr"))
            i += 1
            continue
        if stripped.startswith(">"):
            quoted: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quoted.append(lines[i].strip()[1:].strip())
                i += 1
            out.append(Block("quote", " ".join(quoted)))
            continue
        if "|" in stripped and i + 1 < len(lines) and re.fullmatch(
            r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", lines[i + 1].strip()
        ):
            rows = [_cells(stripped)]
            i += 2
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append(_cells(lines[i].strip()))
                i += 1
            width = len(rows[0])
            rows = [(row + [""] * width)[:width] for row in rows]
            out.append(Block("table", rows=rows))
            continue
        item = _ITEM.match(line)
        if item:
            ordered = item.group(1)[0].isdigit()
            items: list[str] = []
            while i < len(lines):
                match = _ITEM.match(lines[i])
                if match and match.group(1)[0].isdigit() != ordered:
                    break
                if match:
                    items.append(match.group(2))
                elif lines[i].strip() and items and lines[i].startswith(("  ", "\t")):
                    items[-1] += " " + lines[i].strip()
                else:
                    break
                i += 1
            out.append(Block("ol" if ordered else "ul", items=items))
            continue
        paragraph = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and not _starts_block(lines[i]):
            paragraph.append(lines[i].strip())
            i += 1
        out.append(Block("p", " ".join(paragraph)))
    return out


def _starts_block(line: str) -> bool:
    stripped = line.strip()
    return bool(
        stripped.startswith(("#", ">", "```", "~~~", "|"))
        or _ITEM.match(line)
        or re.fullmatch(r"([-*_])(\s*\1){2,}", stripped)
    )


def _cells(row: str) -> list[str]:
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def inline(text: str) -> str:
    """Markdown de linha para o markdown do fpdf2 (**negrito**, __itálico__)."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"(?<![*\w])\*(?!\*)([^*\n]+?)\*(?!\*)", r"__\1__", text)
    text = re.sub(r"(?<!\w)_(?!_)([^_\n]+?)_(?!\w)", r"__\1__", text)
    text = text.replace("~~", "")
    return clean(text)


def _plain(text: str) -> str:
    return inline(text).replace("**", "").replace("__", "")


def _date(meta: dict[str, str]) -> str:
    if meta.get("data"):
        return clean(meta["data"])
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    return f"{now.day} de {_MONTHS[now.month - 1]} de {now.year}"


class _Pdf(FPDF):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.add_font("kz", "", str(FONTS / "LiberationSans-Regular.ttf"))
        self.add_font("kz", "B", str(FONTS / "LiberationSans-Bold.ttf"))
        self.add_font("kz", "I", str(FONTS / "LiberationSans-Italic.ttf"))
        self.add_font("kz", "BI", str(FONTS / "LiberationSans-Bold.ttf"))
        self.add_font("kzmono", "", str(FONTS / "LiberationMono-Regular.ttf"))
        self.footer_title = ""
        self.footer_skip = 1
        self.set_creator("KAZER")
        self.set_author("KAZER")


# ---------------------------------------------------------------------------
# Documento A4
# ---------------------------------------------------------------------------

INK = (15, 23, 42)
INK_2 = (71, 85, 105)
LINE = (226, 232, 240)


class _Document(_Pdf):
    def footer(self) -> None:
        if self.page_no() <= self.footer_skip:
            return
        self.set_y(-14)
        self.set_font("kz", "", 8)
        self.set_text_color(148, 163, 184)
        self.cell(0, 6, self.footer_title[:90], align="L")
        self.set_x(self.l_margin)
        self.cell(0, 6, str(self.page_no()), align="R")


def render_pdf(source: str) -> bytes:
    """Documento A4: capa, sumário (com 3+ seções) e o conteúdo formatado."""
    meta, body = front_matter(source[:MAX_SOURCE])
    accent = _hex(meta.get("cor") or meta.get("color", ""), (37, 99, 235))
    dark = _mix(accent, (0, 0, 0), 0.35)
    title = clean(meta.get("titulo") or meta.get("title") or "Documento")
    subtitle = clean(meta.get("subtitulo") or meta.get("subtitle") or "")
    author = clean(meta.get("autor") or meta.get("author") or "KAZER")
    parsed = blocks(body)

    pdf = _Document(format="A4", unit="mm")
    pdf.set_title(title)
    pdf.footer_title = title
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(True, margin=20)

    # Capa
    pdf.add_page()
    pdf.set_fill_color(*accent)
    pdf.rect(-1, -1, 212, 299, style="F")
    pdf.set_fill_color(*_mix(accent, (255, 255, 255), 0.12))
    pdf.circle(x=150, y=-30, radius=95, style="F")
    pdf.set_fill_color(*_mix(accent, (0, 0, 0), 0.12))
    pdf.circle(x=175, y=255, radius=60, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(24, 26)
    pdf.set_font("kz", "B", 9)
    pdf.cell(0, 6, "K A Z E R")
    if meta.get("tipo"):
        pdf.set_xy(24, 150)
        pdf.set_font("kz", "B", 9)
        pdf.cell(0, 6, clean(meta["tipo"]).upper())
    pdf.set_xy(24, 160)
    pdf.set_font("kz", "B", 34)
    pdf.multi_cell(160, 14, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if subtitle:
        pdf.set_x(24)
        pdf.ln(3)
        pdf.set_font("kz", "", 14)
        pdf.set_x(24)
        pdf.multi_cell(150, 7, subtitle, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_draw_color(255, 255, 255)
    pdf.set_line_width(0.3)
    pdf.line(24, 262, 186, 262)
    pdf.set_font("kz", "", 10)
    pdf.set_xy(24, 266)
    pdf.cell(80, 6, author)
    pdf.set_xy(106, 266)
    pdf.cell(80, 6, _date(meta), align="R")

    # Sumário
    sections = [_plain(block.text) for block in parsed if block.kind == "h1"]
    if len(sections) >= 3:
        pdf.add_page()
        pdf.set_text_color(*INK)
        pdf.set_font("kz", "B", 20)
        pdf.cell(0, 12, "Sumário", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)
        for number, name in enumerate(sections, 1):
            pdf.set_font("kz", "B", 11)
            pdf.set_text_color(*accent)
            pdf.cell(12, 9, f"{number:02d}")
            pdf.set_font("kz", "", 11)
            pdf.set_text_color(*INK)
            pdf.cell(0, 9, name[:90], new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_draw_color(*LINE)
            pdf.line(20, pdf.get_y(), 190, pdf.get_y())

    pdf.add_page()
    _content(pdf, parsed, accent, dark)
    return bytes(pdf.output())


def _content(pdf: FPDF, parsed: list[Block], accent: Color, dark: Color) -> None:
    width = pdf.w - pdf.l_margin - pdf.r_margin
    soft = _mix(accent, (255, 255, 255), 0.9)
    first = True
    for block in parsed:
        if block.kind == "h1":
            if not first and pdf.get_y() > pdf.h - 70:
                pdf.add_page()
            pdf.ln(0 if first else 6)
            pdf.set_font("kz", "B", 18)
            pdf.set_text_color(*INK)
            pdf.multi_cell(0, 9, _plain(block.text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_fill_color(*accent)
            pdf.rect(pdf.l_margin, pdf.get_y() + 1, 22, 1.2, style="F")
            pdf.ln(6)
        elif block.kind == "h2":
            pdf.ln(3)
            pdf.set_font("kz", "B", 13.5)
            pdf.set_text_color(*dark)
            pdf.multi_cell(0, 7, _plain(block.text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(1.5)
        elif block.kind == "h3":
            pdf.ln(2)
            pdf.set_font("kz", "B", 11.5)
            pdf.set_text_color(*INK)
            pdf.multi_cell(0, 6, _plain(block.text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(1)
        elif block.kind == "p":
            pdf.set_font("kz", "", 10.5)
            pdf.set_text_color(*INK)
            pdf.multi_cell(
                0, 5.6, inline(block.text), align="J", markdown=True,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )
            pdf.ln(2.5)
        elif block.kind in ("ul", "ol"):
            pdf.set_font("kz", "", 10.5)
            for number, item in enumerate(block.items or [], 1):
                pdf.set_text_color(*accent)
                pdf.set_font("kz", "B", 10.5)
                pdf.cell(7, 5.6, f"{number}." if block.kind == "ol" else "•")
                pdf.set_text_color(*INK)
                pdf.set_font("kz", "", 10.5)
                pdf.multi_cell(
                    width - 7, 5.6, inline(item), markdown=True,
                    new_x=XPos.LMARGIN, new_y=YPos.NEXT,
                )
                pdf.ln(0.8)
            pdf.ln(2)
        elif block.kind == "quote":
            pdf.set_font("kz", "I", 10.5)
            text = inline(block.text)
            height = pdf.multi_cell(
                width - 12, 5.6, text, markdown=True, dry_run=True, output="HEIGHT"
            )
            if pdf.get_y() + height + 8 > pdf.h - pdf.b_margin:
                pdf.add_page()
            top = pdf.get_y()
            pdf.set_fill_color(*soft)
            pdf.rect(pdf.l_margin, top, width, height + 8, style="F")
            pdf.set_fill_color(*accent)
            pdf.rect(pdf.l_margin, top, 1.4, height + 8, style="F")
            pdf.set_xy(pdf.l_margin + 7, top + 4)
            pdf.set_text_color(*INK)
            pdf.multi_cell(
                width - 12, 5.6, text, markdown=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
            pdf.set_y(top + height + 8)
            pdf.ln(4)
        elif block.kind == "code":
            pdf.set_font("kzmono", "", 8.5)
            pdf.set_fill_color(15, 23, 42)
            pdf.set_text_color(226, 232, 240)
            pdf.ln(1)
            for line in clean(block.text).split("\n") or [""]:
                pdf.set_x(pdf.l_margin)
                pdf.multi_cell(
                    width, 4.6, " " + (line or " "), fill=True,
                    new_x=XPos.LMARGIN, new_y=YPos.NEXT,
                )
            pdf.ln(4)
        elif block.kind == "table" and block.rows:
            pdf.set_font("kz", "", 9.5)
            pdf.set_text_color(*INK)
            pdf.set_draw_color(*LINE)
            pdf.set_fill_color(248, 250, 252)
            from fpdf.fonts import FontFace

            header = FontFace(emphasis="BOLD", color=(255, 255, 255), fill_color=accent)
            with pdf.table(
                headings_style=header,
                line_height=6.2,
                cell_fill_color=(241, 245, 249),
                cell_fill_mode="EVEN_ROWS",
                borders_layout="HORIZONTAL_LINES",
                text_align="LEFT",
                markdown=True,
            ) as table:
                for row in block.rows:
                    cells = table.row()
                    for value in row:
                        cells.cell(inline(value))
            pdf.ln(5)
        elif block.kind == "hr":
            pdf.ln(2)
            pdf.set_draw_color(*LINE)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(5)
        first = False


# ---------------------------------------------------------------------------
# Apresentação 16:9
# ---------------------------------------------------------------------------

SLIDE_W, SLIDE_H = 338.67, 190.5
BG = (7, 7, 10)


class _Deck(_Pdf):
    def footer(self) -> None:
        if self.page_no() <= self.footer_skip:
            return
        self.set_y(SLIDE_H - 13)
        self.set_x(24)
        self.set_font("kz", "", 9)
        self.set_text_color(130, 126, 120)
        self.cell(150, 6, self.footer_title[:80])
        self.set_x(SLIDE_W - 74)
        self.cell(50, 6, str(self.page_no()), align="R")


def render_slides(source: str) -> bytes:
    """Apresentação: capa, divisores de seção e slides de conteúdo, sem limite."""
    meta, body = front_matter(source[:MAX_SOURCE])
    accent = _hex(meta.get("cor") or meta.get("color", ""), (232, 176, 74))
    title = clean(meta.get("titulo") or meta.get("title") or "Apresentação")
    subtitle = clean(meta.get("subtitulo") or meta.get("subtitle") or "")
    author = clean(meta.get("autor") or meta.get("author") or "KAZER")

    deck = _Deck(orientation="L", unit="mm", format=(SLIDE_H, SLIDE_W))
    deck.set_title(title)
    deck.footer_title = title
    deck.set_margins(24, 20, 24)
    deck.set_auto_page_break(False)

    def page() -> None:
        deck.add_page()
        deck.set_fill_color(*BG)
        deck.rect(0, 0, SLIDE_W, SLIDE_H, style="F")

    page()
    deck.set_fill_color(*_mix(accent, BG, 0.75))
    deck.circle(x=SLIDE_W - 40, y=30, radius=95, style="F")
    deck.set_fill_color(*accent)
    deck.rect(24, 84, 22, 2.2, style="F")
    deck.set_xy(24, 92)
    deck.set_text_color(255, 255, 255)
    deck.set_font("kz", "B", 40)
    deck.multi_cell(230, 16, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if subtitle:
        deck.ln(3)
        deck.set_font("kz", "", 16)
        deck.set_text_color(207, 202, 195)
        deck.multi_cell(230, 8, subtitle, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    deck.set_xy(24, SLIDE_H - 22)
    deck.set_font("kz", "", 10)
    deck.set_text_color(150, 146, 140)
    deck.cell(0, 6, f"{author}  ·  {_date(meta)}")

    section = 0
    for markdown in split_slides(body):
        parsed = blocks(markdown)
        if not parsed:
            continue
        page()
        heading = parsed[0] if parsed[0].kind in ("h1", "h2", "h3") else None
        rest = parsed[1:] if heading else parsed
        if heading and not rest:
            section += 1
            deck.set_text_color(*_mix(accent, BG, 0.55))
            deck.set_font("kz", "B", 110)
            deck.set_xy(SLIDE_W - 120, 18)
            deck.cell(96, 50, f"{section:02d}", align="R")
            deck.set_fill_color(*accent)
            deck.rect(24, 92, 22, 2.2, style="F")
            deck.set_xy(24, 100)
            deck.set_text_color(255, 255, 255)
            deck.set_font("kz", "B", 36)
            deck.multi_cell(260, 15, _plain(heading.text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            continue
        top = 22
        if heading:
            deck.set_xy(24, top)
            deck.set_text_color(255, 255, 255)
            deck.set_font("kz", "B", 32)
            deck.multi_cell(290, 13, _plain(heading.text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            deck.set_fill_color(*accent)
            deck.rect(24, deck.get_y() + 2, 18, 1.6, style="F")
            top = deck.get_y() + 10
        _slide_body(deck, rest, accent, top)
    return bytes(deck.output())


def _slide_body(deck: FPDF, parsed: list[Block], accent: tuple[int, int, int], top: float) -> None:
    """Corpo do slide; o tamanho da letra diminui até caber (mínimo legível)."""
    bottom = SLIDE_H - 20
    for size in (24, 21, 18, 16, 14, 12):
        deck.set_y(top)
        if _draw_body(deck, parsed, accent, size, dry=True) <= bottom:
            break
    deck.set_y(top)
    _draw_body(deck, parsed, accent, size, dry=False)


def _draw_body(
    deck: FPDF, parsed: list[Block], accent: tuple[int, int, int], size: float, *, dry: bool
) -> float:
    width = SLIDE_W - 48
    line = size * 0.5
    y = deck.get_y()

    def text(
        content: str,
        x: float,
        w: float,
        style: str = "",
        color: Color = (233, 229, 223),
        markdown: bool = True,
        font: str = "kz",
        fsize: float = size,
    ) -> None:
        nonlocal y
        deck.set_font(font, style, fsize)
        height = deck.multi_cell(
            w, fsize * 0.5, content, markdown=markdown, dry_run=True, output="HEIGHT"
        )
        if not dry:
            deck.set_xy(x, y)
            deck.set_text_color(*color)
            deck.multi_cell(w, fsize * 0.5, content, markdown=markdown,
                            new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        y += height

    for block in parsed:
        if block.kind in ("h1", "h2", "h3"):
            heading = _plain(block.text)
            text(heading, 24, width, "B", (255, 255, 255), markdown=False, fsize=size + 3)
            y += 3
        elif block.kind == "p":
            # "**3x** mais rápido": o número vira destaque gigante, o resto legenda.
            stat = re.match(r"\*\*([^*]{1,24})\*\*\s*(.*)$", block.text.strip())
            if stat:
                text(clean(stat.group(1)), 24, width, "B", accent, markdown=False, fsize=size * 3.4)
                if stat.group(2):
                    y += 2
                    text(inline(stat.group(2)), 24, width, "", (207, 202, 195))
            else:
                text(inline(block.text), 24, width)
            y += 4
        elif block.kind in ("ul", "ol"):
            for number, item in enumerate(block.items or [], 1):
                if not dry and block.kind == "ul":
                    deck.set_fill_color(*accent)
                    deck.rect(25, y + line * 0.38, 2.6, 2.6, style="F")
                mark = f"{number}.  " if block.kind == "ol" else ""
                text(mark + inline(item), 33 if block.kind == "ul" else 24, width - 9)
                y += size * 0.22
            y += 2
        elif block.kind == "quote":
            start = y
            text(inline(block.text), 32, width - 10, "I", (255, 255, 255), fsize=size + 4)
            if not dry:
                deck.set_fill_color(*accent)
                deck.rect(24, start, 1.8, y - start, style="F")
            y += 5
        elif block.kind == "code":
            code = clean(block.text)
            text(code, 26, width - 4, "", (214, 211, 205), markdown=False, font="kzmono",
                 fsize=max(size - 5, 9))
            y += 4
        elif block.kind == "table" and block.rows:
            columns = len(block.rows[0])
            cell_w = width / max(columns, 1)
            for index, row in enumerate(block.rows):
                deck.set_font("kz", "B" if index == 0 else "", size - 3)
                heights = [
                    deck.multi_cell(cell_w - 4, (size - 3) * 0.5, _plain(value), dry_run=True,
                                    output="HEIGHT")
                    for value in row
                ]
                row_h = max(heights) + 4
                if not dry:
                    fill = accent if index == 0 else ((20, 20, 26) if index % 2 else (14, 14, 18))
                    deck.set_fill_color(*fill)
                    deck.rect(24, y, width, row_h, style="F")
                    for col, value in enumerate(row):
                        deck.set_xy(24 + col * cell_w + 2, y + 2)
                        deck.set_text_color(*((20, 16, 9) if index == 0 else (226, 222, 216)))
                        deck.multi_cell(cell_w - 4, (size - 3) * 0.5, _plain(value))
                y += row_h
            y += 4
        elif block.kind == "hr":
            y += 4
    return y


def render(kind: str, source: str) -> bytes:
    """Ponto único usado pela API: `pdf` ou `slides`."""
    if kind == "slides":
        return render_slides(source)
    return render_pdf(source)
