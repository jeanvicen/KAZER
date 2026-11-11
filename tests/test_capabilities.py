"""O registro de capacidades só pode apontar para o que existe de verdade."""

from __future__ import annotations

import re
from pathlib import Path

from starlette.routing import Route

from kazer.capabilities import CAPABILITIES, by_id, public_catalog
from kazer.config.settings import Settings
from kazer.interfaces.web.app import create_app

ROOT = Path(__file__).resolve().parents[1]


def _routes(tmp_path: Path) -> set[str]:
    settings = Settings(
        environment="test",
        public_url="http://testserver",
        database_path=tmp_path / "r.db",
        cookie_secure=False,
    )
    found = set()
    for route in create_app(settings).routes:
        if isinstance(route, Route):
            for method in route.methods or ():
                found.add(f"{method} {route.path}")
    return found


def test_ids_are_unique_and_well_formed() -> None:
    ids = [capability.id for capability in CAPABILITIES]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z]+\.[a-z_]+", value) for value in ids)
    assert by_id("imagens.criar") is not None and by_id("nao.existe") is None


def test_every_entrypoint_module_and_test_exists(tmp_path: Path) -> None:
    routes = _routes(tmp_path)
    for capability in CAPABILITIES:
        for entry in capability.entrypoints:
            assert entry in routes, f"{capability.id}: rota inexistente {entry}"
        for module in (*capability.modules, *capability.tests):
            assert (ROOT / module).is_file(), f"{capability.id}: arquivo inexistente {module}"
        if capability.status == "available":
            assert capability.modules, f"{capability.id}: disponível sem código apontado"


def test_available_server_capabilities_are_tested() -> None:
    for capability in CAPABILITIES:
        if capability.status == "available" and capability.entrypoints:
            assert capability.tests, f"{capability.id}: disponível sem teste"


def test_public_catalog_marks_plan_and_environment() -> None:
    free = {item["id"]: item for item in public_catalog("free")}
    assert free["codigo.kz_code"]["included"] is False
    assert free["chat.conversar"]["included"] is True
    assert free["imagens.criar"]["status"] == "needs_config"
    ready = {i["id"]: i for i in public_catalog("pro", {"imagens.criar": "available"})}
    assert ready["imagens.criar"]["status"] == "available"
    assert ready["codigo.kz_code"]["included"] is True
    assert all("modules" not in item and "entrypoints" not in item for item in free.values())
