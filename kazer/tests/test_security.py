"""Testes mínimos para verificações estruturais de segurança."""

from pathlib import Path


def test_security_boundaries_exist() -> None:
    """Confirma módulos obrigatórios de segurança."""
    root = Path(__file__).parents[1] / "kazer" / "security"
    for module in ("secrets.py", "permissions.py", "input_guard.py", "output_guard.py", "tool_guard.py", "audit_log.py", "rate_limiter.py"):
        assert (root / module).is_file()


def test_env_is_ignored() -> None:
    """Evita inclusão acidental de configuração local versionada."""
    root = Path(__file__).parents[1]
    assert ".env" in (root / ".gitignore").read_text(encoding="utf-8")
