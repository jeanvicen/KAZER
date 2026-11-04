from kazer.chat.artifacts import extract


def test_named_short_file_is_an_artifact() -> None:
    drafts = extract("Aqui está:\n```json config.json\n{}\n```")
    assert len(drafts) == 1
    assert drafts[0].title == "config.json"
    assert drafts[0].kind == "data"


def test_unnamed_short_snippet_stays_in_chat() -> None:
    assert extract("```python\nprint(1)\n```") == []


def test_large_named_file_still_has_a_preview() -> None:
    content = "x" * 500
    drafts = extract(f"```html pagina.html\n{content}\n```")
    assert len(drafts) == 1
    assert drafts[0].title == "pagina.html"
    assert drafts[0].content == content
