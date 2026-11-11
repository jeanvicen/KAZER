"""Criação: imagens com cota diária, projetos do Studio e catálogo de capacidades."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from starlette.testclient import TestClient

from kazer.auth.service import AuthService
from kazer.auth.store import AuthStore
from kazer.chat.service import ChatError, ChatService
from kazer.config.settings import Settings
from kazer.images import providers
from kazer.images.providers import DemoProvider, Generated, ImageError
from kazer.images.service import ImageService, next_reset, utc_day
from kazer.interfaces.web import app as app_module
from kazer.interfaces.web.app import create_app
from kazer.security.passwords import PasswordHashing
from kazer.security.rate_limiter import RateLimiter

ORIGIN = "http://testserver"
PASSWORD = "correct horse battery"
PNG = DemoProvider().generate("x", 64, 64, 1).data


class FakeImages:
    """Provedor de teste: conta chamadas e falha quando mandado."""

    name = "fake"
    label = "Teste"

    def __init__(self) -> None:
        self.calls = 0
        self.fail: str | None = None
        self.crash = False
        self.gate: threading.Event | None = None

    def generate(self, prompt: str, width: int, height: int, seed: int) -> Generated:
        self.calls += 1
        if self.gate is not None:
            self.gate.wait(5)
        if self.crash:
            raise RuntimeError("boom")
        if self.fail:
            raise ImageError(self.fail)
        return Generated(PNG, "image/png")


class World:
    def __init__(self, tmp_path: Path, provider: FakeImages | None) -> None:
        self.settings = Settings(
            environment="test",
            public_url=ORIGIN,
            database_path=tmp_path / "c.db",
            upload_dir=tmp_path / "up",
            cookie_secure=False,
        )
        self.auth = AuthService(
            AuthStore(self.settings.database_path),
            PasswordHashing(PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)),
            type("Mail", (), {"send": lambda self, message: None})(),
            RateLimiter(),
            self.settings.public_origin,
        )
        self.chat: ChatService = app_module._build_chat(self.settings, None)
        self.provider = provider
        self.app = create_app(self.settings, self.auth, chat=self.chat, image_provider=provider)

    def client(self, email: str) -> TestClient:
        client = TestClient(self.app, headers={"Origin": ORIGIN})
        client.__enter__()
        response = client.post("/api/auth/register", json={"email": email, "password": PASSWORD})
        assert response.status_code == 201
        return client


@pytest.fixture
def world(tmp_path: Path) -> Iterator[World]:
    yield World(tmp_path, FakeImages())


def make(client: TestClient, key: str, prompt: str = "um gato dourado na chuva"):
    return client.post("/api/images", json={"prompt": prompt, "idempotency_key": key})


# ---------- Imagens: cota ----------


def test_one_image_per_day_and_second_is_blocked(world: World) -> None:
    ana = world.client("ana@example.com")
    status = ana.get("/api/images").json()
    assert status["available"] is True
    assert status["quota"] == {
        "limit": 1,
        "used": 0,
        "in_progress": 0,
        "remaining": 1,
        "resets_at": status["quota"]["resets_at"],
    }

    first = make(ana, "chave-0001")
    assert first.status_code == 201
    body = first.json()
    assert body["image"]["status"] == "succeeded" and body["quota"]["remaining"] == 0
    picture = ana.get(body["image"]["url"])
    assert picture.status_code == 200 and picture.content == PNG
    assert picture.headers["content-type"] == "image/png"
    assert picture.headers["cache-control"] == "no-store"

    second = make(ana, "chave-0002")
    assert second.status_code == 429
    assert second.json()["error"] == "image_quota"
    assert second.json()["resets_at"] == body["quota"]["resets_at"]
    assert world.provider.calls == 1, "pedido barrado nem chega ao provedor"


def test_same_key_never_generates_twice(world: World) -> None:
    ana = world.client("ana@example.com")
    first = make(ana, "repetida-01")
    again = make(ana, "repetida-01", prompt="outro texto qualquer")
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["replayed"] is True
    assert again.json()["image"]["id"] == first.json()["image"]["id"]
    assert world.provider.calls == 1


@pytest.mark.parametrize("code", ["image_failed", "image_timeout", "image_busy"])
def test_failure_does_not_spend_the_day(world: World, code: str) -> None:
    ana = world.client("ana@example.com")
    world.provider.fail = code
    failed = make(ana, "falha-0001")
    assert failed.status_code in (502, 503) and failed.json()["error"] == code
    assert ana.get("/api/images").json()["quota"]["remaining"] == 1

    world.provider.fail = None
    assert make(ana, "falha-0002").status_code == 201
    assert ana.get("/api/images").json()["quota"]["remaining"] == 0


def test_unexpected_crash_releases_the_slot(world: World) -> None:
    ana = world.client("ana@example.com")
    world.provider.crash = True
    with pytest.raises(RuntimeError):
        make(ana, "quebra-0001")
    world.provider.crash = False
    assert make(ana, "quebra-0002").status_code == 201


def test_parallel_requests_cannot_beat_the_quota(world: World, tmp_path: Path) -> None:
    ana = world.client("ana@example.com")
    user_id = world.auth.session_user(ana.cookies.get("kazer_session")).id
    service = ImageService(
        world.chat.store, world.chat.uploads, world.provider, limit_of=lambda _: 1
    )
    world.provider.gate = threading.Event()
    outcomes: list[str] = []

    def attempt(index: int) -> None:
        try:
            service.create(
                user_id, {"prompt": "corrida de pedidos", "idempotency_key": f"corrida-{index:04d}"}
            )
            outcomes.append("ok")
        except ChatError as exc:
            outcomes.append(exc.code)

    with ThreadPoolExecutor(8) as pool:
        futures = [pool.submit(attempt, i) for i in range(8)]
        threading.Timer(0.3, world.provider.gate.set).start()
        for future in futures:
            future.result()
    assert outcomes.count("ok") == 1, outcomes
    assert set(outcomes) <= {"ok", "image_in_progress", "image_quota"}
    assert world.provider.calls == 1


def test_quota_resets_on_next_utc_day_and_stale_reservation_expires(world: World) -> None:
    ana = world.client("ana@example.com")
    user_id = world.auth.session_user(ana.cookies.get("kazer_session")).id
    clock = [1_800_000_000.0]  # 2027-01-15 08:00 UTC
    service = ImageService(
        world.chat.store,
        world.chat.uploads,
        world.provider,
        limit_of=lambda _: 1,
        clock=lambda: clock[0],
        stale_after=600,
    )
    service.create(user_id, {"prompt": "primeira do dia", "idempotency_key": "dia-000001"})
    with pytest.raises(ChatError) as blocked:
        service.create(user_id, {"prompt": "segunda do dia", "idempotency_key": "dia-000002"})
    assert blocked.value.code == "image_quota"
    assert blocked.value.extra["resets_at"] == next_reset(clock[0])

    clock[0] = next_reset(clock[0]) + 1
    assert utc_day(clock[0]) == "2027-01-16"
    assert service.quota(user_id)["remaining"] == 1
    # Pedido que ficou reservado (função morreu no meio) prende a vaga só por um tempo.
    reserved = world.chat.store.image_reserve(
        user_id, "abandonado-1", "x", 64, 64, utc_day(clock[0]), 1, int(clock[0]), 600
    )
    assert reserved.job is not None
    with pytest.raises(ChatError) as busy:
        service.create(user_id, {"prompt": "enquanto trava", "idempotency_key": "dia-000003"})
    assert busy.value.code == "image_in_progress"
    clock[0] += 601
    job, _ = service.create(user_id, {"prompt": "depois da trava", "idempotency_key": "dia-000004"})
    assert job.status == "succeeded"
    late = world.chat.store.image_finish(user_id, reserved.job.id, True, int(clock[0]))
    assert late is None, "reserva expirada não pode virar sucesso depois"


# ---------- Imagens: isolamento e validação ----------


def test_other_account_cannot_reach_images(world: World) -> None:
    ana = world.client("ana@example.com")
    bia = world.client("bia@example.com")
    image = make(ana, "da-ana-0001").json()["image"]

    assert bia.get(image["url"]).status_code == 404
    assert bia.delete(f"/api/images/{image['id']}").status_code == 404
    assert bia.get("/api/images").json()["images"] == []
    assert bia.get("/api/images").json()["quota"]["remaining"] == 1, "cota é por conta"
    assert make(bia, "da-bia-0001").status_code == 201

    assert ana.delete(f"/api/images/{image['id']}").json() == {"status": "deleted"}
    assert ana.get(image["url"]).status_code == 404
    assert make(ana, "da-ana-0002").status_code == 429, "apagar não devolve a imagem do dia"


def test_images_require_login_origin_and_valid_input(world: World) -> None:
    anonymous = TestClient(world.app, headers={"Origin": ORIGIN})
    assert anonymous.get("/api/images").status_code == 401
    assert anonymous.post("/api/images", json={}).status_code == 401
    assert anonymous.get("/api/images/abc/file").status_code == 401

    ana = world.client("ana@example.com")
    assert make(ana, "curta").status_code == 400
    assert make(ana, "chave-valida-1", prompt="oi").json()["error"] == "image_prompt_short"
    assert make(ana, "chave-valida-2", prompt="x" * 801).json()["error"] == "image_prompt_long"
    bad_aspect = ana.post(
        "/api/images",
        json={"prompt": "um gato", "idempotency_key": "chave-valida-3", "aspect": "7:1"},
    )
    assert bad_aspect.status_code == 400
    forged = ana.post(
        "/api/images",
        json={"prompt": "um gato", "idempotency_key": "chave-valida-4"},
        headers={"Origin": "https://evil.example"},
    )
    assert forged.status_code == 403
    assert ana.get("/api/images/../../etc/file").status_code == 404
    assert world.provider.calls == 0
    assert ana.get("/api/images").json()["quota"]["remaining"] == 1


def test_without_provider_the_feature_says_so(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("KAZER_IMAGE_PROVIDER", raising=False)
    monkeypatch.delenv("KAZER_IMAGE_ENDPOINT_URL", raising=False)
    world = World(tmp_path, None)
    ana = world.client("ana@example.com")
    assert ana.get("/api/images").json()["available"] is False
    refused = make(ana, "sem-provedor-1")
    assert refused.status_code == 503 and refused.json()["error"] == "image_unavailable"
    item = next(
        c for c in ana.get("/api/capabilities").json()["capabilities"] if c["id"] == "imagens.criar"
    )
    assert item["status"] == "needs_config"


def test_provider_loading_rules() -> None:
    assert providers.load({}) is None
    assert providers.load({"KAZER_IMAGE_PROVIDER": "demo"}).name == "demo"
    assert providers.load({"KAZER_IMAGE_PROVIDER": "demo"}, production=True) is None
    assert providers.load({"KAZER_IMAGE_ENDPOINT_URL": "https://gpu.exemplo.com/gerar"}).name == (
        "endpoint"
    )
    # http só em localhost e fora de produção: nada de pedido em texto puro pela internet.
    assert providers.load({"KAZER_IMAGE_ENDPOINT_URL": "http://gpu.exemplo.com/gerar"}) is None
    assert providers.load({"KAZER_IMAGE_ENDPOINT_URL": "http://127.0.0.1:9/g"}).name == "endpoint"
    assert (
        providers.load({"KAZER_IMAGE_ENDPOINT_URL": "http://127.0.0.1:9/g"}, production=True)
        is None
    )
    assert providers.sniff(PNG) == "image/png"
    assert providers.sniff(b"<html>nope</html>") is None


# ---------- Studio ----------


def document(width: int = 1080, height: int = 1080, **extra: object) -> str:
    return json.dumps({"v": 1, "w": width, "h": height, "bg": "#0b0b0b", "canvas": {}, **extra})


def test_design_create_edit_reopen_delete(world: World) -> None:
    ana = world.client("ana@example.com")
    assert ana.get("/api/designs").json() == {"designs": [], "limit": 30}

    created = ana.post("/api/designs", json={"title": "  Post‮ de teste ", "data": document()})
    assert created.status_code == 201
    design = created.json()["design"]
    assert design["title"] == "Post de teste" and design["width"] == 1080

    changed = ana.put(
        f"/api/designs/{design['id']}",
        json={
            "title": "Post final",
            "data": document(1080, 1350, canvas={"objects": [{"type": "Textbox", "text": "Olá"}]}),
            "thumb": "data:image/jpeg;base64,AAAA",
        },
    )
    assert changed.status_code == 200 and changed.json()["design"]["height"] == 1350

    reopened = ana.get(f"/api/designs/{design['id']}").json()["design"]
    assert json.loads(reopened["data"])["canvas"]["objects"][0]["text"] == "Olá"
    assert reopened["thumb"].startswith("data:image/jpeg")
    listed = ana.get("/api/designs").json()["designs"]
    assert [item["title"] for item in listed] == ["Post final"] and "data" not in listed[0]

    assert ana.delete(f"/api/designs/{design['id']}").json() == {"status": "deleted"}
    assert ana.get(f"/api/designs/{design['id']}").status_code == 404


def test_design_is_private_to_its_account(world: World) -> None:
    ana = world.client("ana@example.com")
    bia = world.client("bia@example.com")
    design = ana.post("/api/designs", json={"title": "Da Ana", "data": document()}).json()["design"]
    url = f"/api/designs/{design['id']}"

    assert bia.get(url).status_code == 404
    assert bia.put(url, json={"title": "Roubado", "data": document()}).status_code == 404
    assert bia.delete(url).status_code == 404
    assert bia.get("/api/designs").json()["designs"] == []
    assert ana.get(url).json()["design"]["title"] == "Da Ana"


def test_design_validation_and_limit(world: World) -> None:
    ana = world.client("ana@example.com")
    post = lambda data, **more: ana.post("/api/designs", json={"title": "t", "data": data, **more})  # noqa: E731
    assert post("não é json").status_code == 400
    assert post(json.dumps({"v": 2, "w": 100, "h": 100, "canvas": {}})).status_code == 400
    assert post(document(20000, 100)).status_code == 400
    assert post(json.dumps({"v": 1, "w": 100, "h": 100})).status_code == 400
    # Miniatura que não é imagem em base64 é descartada, não guardada.
    odd = post(document(), thumb="javascript:alert(1)")
    assert odd.status_code == 201 and odd.json()["design"]["thumb"] == ""
    anonymous = TestClient(world.app, headers={"Origin": ORIGIN})
    assert anonymous.get("/api/designs").status_code == 401

    user_id = world.auth.session_user(ana.cookies.get("kazer_session")).id
    limited = app_module.StudioService(world.chat.store, limit_of=lambda _: 1)
    with pytest.raises(ChatError) as full:
        limited.save(user_id, None, {"title": "mais um", "data": document()})
    assert full.value.code == "design_limit"
