"""Cada teste começa com o governador de limites da Groq zerado."""

from collections.abc import Iterator

import pytest

from kazer.brain.groq_limits import GOVERNOR
from kazer.chat.web_tools import _SEARCH_CACHE


@pytest.fixture(autouse=True)
def _control_off(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """Testes não leem o painel real: ligar a manutenção não quebra o CI."""
    missing = tmp_path_factory.getbasetemp() / "sem-controle.yaml"
    monkeypatch.setenv("KAZER_CONTROL_FILE", str(missing))


@pytest.fixture(autouse=True)
def _fresh_limits() -> Iterator[None]:
    GOVERNOR.reset()
    _SEARCH_CACHE.clear()
    yield
    GOVERNOR.reset()
    _SEARCH_CACHE.clear()
