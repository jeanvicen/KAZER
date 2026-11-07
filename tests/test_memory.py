"""Testes estruturais mínimos da arquitetura de memória."""

from pathlib import Path


def test_memory_modules_exist() -> None:
    """Confirma separação dos contratos de memória."""
    root = Path(__file__).parents[1] / "kazer" / "memory"
    modules = (
        "base.py",
        "short_term.py",
        "long_term.py",
        "vector_store.py",
        "project_memory.py",
        "memory_policy.py",
    )
    for module in modules:
        assert (root / module).is_file()
