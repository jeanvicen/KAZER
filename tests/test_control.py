"""Painel do dono: manutenção e aviso global (controle-de-notificacao/controle.yaml)."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

import pytest
import yaml
from argon2 import PasswordHasher
from starlette.testclient import TestClient

from kazer.auth.service import AuthService
from kazer.auth.store import AuthStore
from kazer.config import control
from kazer.config.control import BRASILIA, ControlError, parse, read
from kazer.config.settings import Settings
from kazer.interfaces.web.app import create_app
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://testserver"
PASSWORD = "correct horse battery"
_tick = [1_000_000_000.0]


def write(path: Path, data: dict | str) -> None:
    """Grava o arquivo e avança o mtime (o cache relê só quando ele muda)."""
    path.write_text(data if isinstance(data, str) else yaml.safe_dump(data), encoding="utf-8")
    _tick[0] += 10
    os.utime(path, (_tick[0], _tick[0]))


def config(**overrides: dict) -> dict:
    base = {
        "manutencao": {"ativa": False, "titulo": "Manutenção", "mensagem": "", "liberados": []},
        "notificacao": {
            "ativa": False,
            "id": "a1",
            "tipo": "info",
            "titulo": "Oi",
            "mensagem": "x",
        },
    }
    for name, values in overrides.items():
        base[name].update(values)
    return base


@pytest.fixture
def panel(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "controle.yaml"
    write(path, config())
    monkeypatch.setenv("KAZER_CONTROL_FILE", str(path))
    return path


@pytest.fixture
def web(tmp_path: Path, panel: Path) -> Iterator[TestClient]:
    settings = Settings(
        environment="test",
        public_url=ORIGIN,
        database_path=tmp_path / "c.db",
        cookie_secure=False,
    )
    service = AuthService(
        AuthStore(settings.database_path),
        PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
        type("Mail", (), {"send": lambda self, message: None})(),
        RateLimiter(),
        settings.public_origin,
    )
    with TestClient(create_app(settings, service), headers={"Origin": ORIGIN}) as client:
        yield client


def register(client: TestClient, email: str) -> None:
    response = client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201


# ---------- Arquivo ----------


def test_repository_file_is_valid_and_ships_switched_off() -> None:
    state = read(ROOT / "controle-de-notificacao" / "controle.yaml")
    assert state.maintenance.active is False
    assert state.notice.active is False


def test_validator_script_accepts_the_repository_file() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "controle.py")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Arquivo OK" in result.stdout


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"manutencao": {"ativa": "sim"}}, "true ou false"),
        ({"manutencao": {"liberados": ["não-é-email"]}}, "e-mail inválido"),
        ({"manutencao": {"titulo": "x" * 81}}, "80 caracteres"),
        ({"notificacao": {"tipo": "festa"}}, "tipo"),
        ({"notificacao": {"id": "tem espaço"}}, "id"),
        ({"notificacao": {"botao_texto": "Ver", "botao_link": "javascript:alert(1)"}}, "https://"),
        ({"notificacao": {"botao_texto": "Ver", "botao_link": "http://x.com"}}, "https://"),
        ({"notificacao": {"botao_texto": "Ver", "botao_link": "//evil.com"}}, "https://"),
        ({"notificacao": {"botao_texto": "Ver"}}, "botao_texto E botao_link"),
        ({"notificacao": {"inicio": "amanhã"}}, "AAAA-MM-DD HH:MM"),
        ({"notificacao": {"inicio": "2026-11-10 10:00", "fim": "2026-11-10 09:00"}}, "depois"),
    ],
)
def test_invalid_fields_explain_the_problem(change: dict, message: str) -> None:
    with pytest.raises(ControlError, match=message):
        parse(config(**change))


def test_broken_file_keeps_kazer_running(panel: Path) -> None:
    write(panel, "manutencao: [isso não fecha")
    with pytest.raises(ControlError, match="linha"):
        read(panel)
    assert control.current() == control.OFF


def test_missing_file_means_everything_off(tmp_path: Path) -> None:
    assert read(tmp_path / "nada.yaml") == control.OFF


def test_notice_time_window_uses_brasilia() -> None:
    state = parse(
        config(notificacao={"ativa": True, "inicio": "2026-11-10 08:00", "fim": "2026-11-10 18:00"})
    )
    before = datetime(2026, 11, 10, 7, 59, tzinfo=BRASILIA)
    during = datetime(2026, 11, 10, 12, 0, tzinfo=BRASILIA)
    after = datetime(2026, 11, 10, 18, 0, tzinfo=BRASILIA)
    assert state.status(now=before)["aviso"] is None
    assert state.status(now=during)["aviso"]["titulo"] == "Oi"
    assert state.status(now=after)["aviso"] is None


def test_cache_rereads_only_when_file_changes(panel: Path) -> None:
    assert control.current().maintenance.active is False
    write(panel, config(manutencao={"ativa": True}))
    assert control.current().maintenance.active is True


# ---------- Rotas ----------


def test_status_is_public_and_hides_allowed_emails(web: TestClient, panel: Path) -> None:
    write(
        panel,
        config(
            manutencao={"ativa": True, "previsao": "18h", "liberados": ["dono@example.com"]},
            notificacao={"ativa": True},
        ),
    )
    body = web.get("/api/status").json()
    assert body["manutencao"] == {
        "ativa": True,
        "titulo": "Manutenção",
        "mensagem": "",
        "previsao": "18h",
        "liberado": False,
    }
    assert body["aviso"]["id"] == "a1"
    assert "dono@example.com" not in web.get("/api/status").text


def test_maintenance_blocks_apis_signup_and_login(web: TestClient, panel: Path) -> None:
    register(web, "ana@example.com")
    assert web.get("/api/conversations").status_code == 200

    write(panel, config(manutencao={"ativa": True}))
    blocked = web.get("/api/conversations")
    assert blocked.status_code == 503
    assert blocked.json()["error"] == "maintenance"

    web.post("/api/auth/logout")
    login = web.post("/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD})
    assert login.status_code == 503 and login.json()["error"] == "maintenance"
    signup = web.post(
        "/api/auth/register", json={"email": "novo@example.com", "password": PASSWORD}
    )
    assert signup.status_code == 503
    assert web.get("/api/health").status_code == 200

    write(panel, config(manutencao={"ativa": False}))
    login = web.post("/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD})
    assert login.status_code == 200
    assert web.get("/api/conversations").status_code == 200


def test_allowed_email_keeps_using_kazer(web: TestClient, panel: Path) -> None:
    register(web, "Dono@Example.com")
    write(panel, config(manutencao={"ativa": True, "liberados": ["dono@example.com"]}))
    assert web.get("/api/conversations").status_code == 200
    assert web.get("/api/status").json()["manutencao"]["liberado"] is True
