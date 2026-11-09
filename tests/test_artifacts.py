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


def test_artifacts_only_when_the_person_asks_for_a_deliverable() -> None:
    from kazer.chat.artifacts import extract, wants_deliverable

    asks = [
        "crie um site de uma página para minha loja",
        "gera um PDF com o resumo",
        "faz uma apresentação de 10 slides sobre IA",
        "me manda o arquivo",
        "salva isso em index.html",
        "me ajuda a criar um jogo em Godot",
        "create a landing page for my startup",
        "escreve um script python que renomeia arquivos",
    ]
    talks = [
        "Como criar jogos passo a passo",
        "como funciona a fotossíntese?",
        "oi tudo bem",
        "me explica machine learning",
        "how do I build a website?",
    ]
    assert all(wants_deliverable(text) for text in asks)
    assert not any(wants_deliverable(text) for text in talks)
    big = "```yaml trainer_config.yaml\n" + "behaviors:\n  agent: 1\n" * 40 + "```\n"
    assert extract(big, "Como criar jogos passo a passo") == []
    assert len(extract(big, "me manda o arquivo de configuração")) == 1
