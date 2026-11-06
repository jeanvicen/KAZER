"""Cada teste começa com o governador de limites da Groq zerado."""

from collections.abc import Iterator

import pytest

from kazer.brain.groq_limits import GOVERNOR


@pytest.fixture(autouse=True)
def _fresh_limits() -> Iterator[None]:
    GOVERNOR.reset()
    yield
    GOVERNOR.reset()
