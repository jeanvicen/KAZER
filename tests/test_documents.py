"""PDF de verdade, leitura de anexos e fontes salvas na resposta."""

import io
import zipfile

from pypdf import PdfReader

from kazer.brain.model_provider import Part
from kazer.chat import context, extract
from kazer.chat.documents import front_matter, render_pdf, render_slides, split_slides
from kazer.chat.store import Attachment, Message
from kazer.chat.uploads import detect

DOC = """---
titulo: Relatório — “Mercado” 2026
cor: #2563eb
---
# Introdução
Texto com **negrito**, *itálico* e emoji 🚀.

# Números
| Ano | Usuários |
|---|---|
| 2026 | 3M |

# Conclusão
> Destaque.

1. um
2. dois
"""


def test_pdf_is_a_real_file_with_the_text() -> None:
    data = render_pdf(DOC)
    assert data.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Relatório" in text and "Introdução" in text and "Sumário" in text
    assert reader.metadata.title == "Relatório — “Mercado” 2026"


def test_slides_have_one_page_per_slide_and_no_limit() -> None:
    body = "\n---\n".join(f"# Slide {n}\n- ponto" for n in range(1, 31))
    data = render_slides(f"---\ntitulo: Deck\n---\n{body}")
    # capa + 30 slides
    assert len(PdfReader(io.BytesIO(data)).pages) == 31
    assert len(split_slides(body)) == 30
    assert front_matter("---\ntitulo: X\n---\ncorpo") == ({"titulo": "X"}, "corpo")


def _zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        for name, body in files.items():
            archive.writestr(name, body)
    return buffer.getvalue()


def test_office_files_are_detected_by_content_and_read() -> None:
    docx = _zip({"word/document.xml": "<w:p><w:t>Olá Word</w:t></w:p><w:p><w:t>2</w:t></w:p>"})
    xlsx = _zip({
        "xl/workbook.xml": "<workbook/>",
        "xl/sharedStrings.xml": "<sst><si><t>Nome</t></si><si><t>Ana</t></si></sst>",
        "xl/worksheets/sheet1.xml": '<row><c t="s"><v>0</v></c><c><v>42</v></c></row>'
        '<row><c t="s"><v>1</v></c></row>',
    })
    pptx = _zip(
        {"ppt/presentation.xml": "<p/>", "ppt/slides/slide1.xml": "<a:t>Título do slide</a:t>"}
    )
    assert detect(docx, "x.bin").kind == "file"
    assert "Olá Word" in extract.text_of("file", "a.docx", docx)
    assert "Nome | 42" in extract.text_of("file", "a.xlsx", xlsx)
    assert "Título do slide" in extract.text_of("file", "a.pptx", pptx)


def test_pdf_attachment_becomes_text_when_the_model_cannot_read_pdfs() -> None:
    pdf = render_pdf("# Capítulo\nConteúdo secreto do PDF")
    attachment = Attachment(
        id="a" * 20, user_id="u", message_id="m", kind="pdf",
        media_type="application/pdf", name="doc.pdf", size=len(pdf), created_at=0,
    )
    message = Message(
        id="m", conversation_id="c", seq=1, role="user", content="resuma", thinking="",
        status="complete", error_code=None, stop_reason=None, options={}, created_at=0,
        finished_at=0, attachments=(attachment,),
    )
    turns = context.build_turns([message], lambda _a: pdf, images=False, documents=False)
    texts = [part.text for part in turns[0].parts if isinstance(part, Part)]
    assert any("Conteúdo secreto do PDF" in text for text in texts)


def test_sources_block_never_goes_back_to_the_model() -> None:
    answer = 'Resposta.\n\n```kazer-fontes\n[{"t":"x","u":"https://a.b","k":"lido"}]\n```\n'
    assert context.without_sources(answer).strip() == "Resposta."


def test_more_than_100_abilities_turn_on_by_themselves() -> None:
    from kazer.chat import abilities

    assert len(abilities.ABILITIES) > 100
    assert len({a.slug for a in abilities.ABILITIES}) == len(abilities.ABILITIES)
    assert [a.slug for a in abilities.pick("meu código python dá erro")] == ["depuracao", "python"]
    assert abilities.pick("oi, tudo bem?") == []
    prompt = context.system_prompt(
        now=0, timezone=None, nickname="", style="equilibrado", instructions="",
        memories=[], web_search=False, question="me explica como funciona um motor",
    )
    assert "Explicar como professor" in prompt
