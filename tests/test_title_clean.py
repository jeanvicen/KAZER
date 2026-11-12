"""O título da conversa nunca mostra markdown cru na barra do topo."""

import pytest

from kazer.chat.service import clean_title


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("## Resumo rápido\nO **KAZER** respondeu", "Resumo rápido"),
        ("**Planejar a semana**", "Planejar a semana"),
        ('Título: "Viagem ao Rio"', "Viagem ao Rio"),
        ("Title: `Deploy na Vercel`", "Deploy na Vercel"),
        ("[Receita de bolo](https://exemplo.com) fácil", "Receita de bolo fácil"),
        ("\n\n---\n# Ideias de site\n", "Ideias de site"),
        ("   ", ""),
    ],
)
def test_clean_title_strips_markup(raw: str, expected: str) -> None:
    assert clean_title(raw) == expected
