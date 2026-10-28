"""Testes estruturais mínimos do núcleo."""

from pathlib import Path


def test_core_modules_exist() -> None:
    """Confirma presença de contratos básicos sem executar lógica de negócio."""
    root = Path(__file__).parents[1] / "kazer" / "core"
    for module in ("agent.py", "orchestrator.py", "planner.py", "executor.py", "router.py", "state.py", "events.py"):
        assert (root / module).is_file()
