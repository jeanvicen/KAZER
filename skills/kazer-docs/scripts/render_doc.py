#!/usr/bin/env python3
"""
kazer-docs — render a Markdown deliverable to PDF and DOCX.

Usage:
    python render_doc.py <input.md> [--pdf out.pdf] [--docx out.docx]

The Markdown produced by the KAZER Docs skill uses standard GFM plus the
tables and code fences the renderer understands. Images referenced with
relative paths are resolved next to the input file.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


def read_source(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def estimate_reading_time(text: str) -> int:
    """Words per minute, pt-BR averages around 200."""
    words = len(re.findall(r"\w+", text))
    return max(1, round(words / 200))


def extract_title(text: str) -> str:
    match = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
    return match.group(1).strip() if match else "Documento"


def to_docx(text: str, out_path: pathlib.Path) -> None:
    """Requires python-docx. Falls back to a .txt-with-markup file."""
    try:
        from docx import Document  # type: ignore
        from docx.shared import Pt
    except ImportError:
        out_path.with_suffix(".txt").write_text(text, encoding="utf-8")
        print(f"python-docx ausente; gerado {out_path.with_suffix('.txt')}", file=sys.stderr)
        return

    document = Document()
    for line in text.splitlines():
        stripped = line.strip()

        if not stripped:
            continue
        if stripped.startswith("### "):
            document.add_heading(stripped[4:], level=3)
        elif stripped.startswith("## "):
            document.add_heading(stripped[3:], level=2)
        elif stripped.startswith("# "):
            document.add_heading(stripped[2:], level=1)
        elif stripped.startswith(("- ", "* ")):
            document.add_paragraph(stripped[2:], style="List Bullet")
        elif stripped.startswith(">"):
            paragraph = document.add_paragraph(stripped.lstrip("> "))
            paragraph.runs[0].italic = True
        else:
            paragraph = document.add_paragraph(stripped)
            for run in paragraph.runs:
                run.font.size = Pt(11)

    document.save(out_path)


def to_pdf(text: str, out_path: pathlib.Path) -> None:
    """Uses weasyprint when available; otherwise prints an actionable hint."""
    try:
        from weasyprint import HTML  # type: ignore
    except ImportError:
        print(
            "weasyprint ausente. Instale com: pip install weasyprint\n"
            f"Markdown pronto em: {out_path.with_suffix('.md')}",
            file=sys.stderr,
        )
        out_path.with_suffix(".md").write_text(text, encoding="utf-8")
        return

    html_body = re.sub(
        r"^#\s+(.+)$",
        r"<h1>\1</h1>",
        text,
        flags=re.MULTILINE,
    )
    html_body = re.sub(r"^##\s+(.+)$", r"<h2>\1</h2>", html_body, flags=re.MULTILINE)
    html_body = re.sub(r"^###\s+(.+)$", r"<h3>\1</h3>", html_body, flags=re.MULTILINE)
    html_body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html_body)
    html_body = re.sub(r"`(.+?)`", r"<code>\1</code>", html_body)

    HTML(string=f"<html><body>{html_body}</body></html>").write_pdf(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a KAZER document.")
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--pdf", type=pathlib.Path)
    parser.add_argument("--docx", type=pathlib.Path)
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Arquivo não encontrado: {args.input}", file=sys.stderr)
        sys.exit(1)

    text = read_source(args.input)
    title = extract_title(text)
    print(f"Documento: {title}")
    print(f"Tempo de leitura estimado: {estimate_reading_time(text)} min")

    if args.pdf:
        to_pdf(text, args.pdf)
        print(f"PDF:  {args.pdf}")
    if args.docx:
        to_docx(text, args.docx)
        print(f"DOCX: {args.docx}")

    if not args.pdf and not args.docx:
        print(text)


if __name__ == "__main__":
    main()
