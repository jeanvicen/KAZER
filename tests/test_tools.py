"""Testes mínimos dos contratos e da declaração de permissões."""

from pathlib import Path

from kazer.tools.base_tool import Permission


def test_tool_permission_vocabulary() -> None:
    """Permissões disponíveis correspondem ao vocabulário de política."""
    assert {permission.value for permission in Permission} == {
        "read", "write", "network", "shell", "filesystem", "admin"
    }


def test_tool_modules_exist() -> None:
    """Confirma módulos de ferramentas solicitados."""
    root = Path(__file__).parents[1] / "kazer" / "tools"
    for module in ("registry.py", "base_tool.py", "web_search.py", "browser.py", "filesystem.py", "code_runner.py", "api_client.py", "database.py", "messaging.py"):
        assert (root / module).is_file()
