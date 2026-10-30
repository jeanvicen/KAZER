"""Planos do KAZER: catálogo, uso e a oferta que aparece quando o limite acaba.

O catálogo em Python e a franquia no Postgres são dois lugares contando a mesma
história. O primeiro teste lê a migração e falha se alguém mexer num lado só.
"""

import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.chat import plans
from tests.test_chat import Env, FakeProvider, send


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    """Mesmo ambiente do teste do chat; fixture não cruza módulo sozinha."""

    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


MIGRATION = Path(__file__).resolve().parents[1] / (
    "supabase/migrations/20261029180000_kazer_chat_storage.sql"
)


def test_the_catalog_matches_the_quota_in_the_database() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    body = re.search(
        r"create or replace function public\.kazer_plan_quota.*?\$\$(.*?)\$\$",
        sql,
        re.DOTALL,
    )
    assert body, "função kazer_plan_quota não encontrada na migração"
    quota = body.group(1)

    # `case plan_name when 'ultra' then 3000 when 'pro' then 800 else 120 end`
    named = dict(re.findall(r"when '(\w+)' then (\d+)", quota))
    fallback = re.search(r"else (\d+) end", quota)
    assert fallback, "a franquia do plano gratuito precisa estar no `else`"
    named["free"] = fallback.group(1)

    for plan in plans.PLANS:
        assert int(named[plan.id]) == plan.allowance, f"franquia divergente em {plan.id}"

    hours = re.search(r"(\d+)::integer", quota)
    assert hours and int(hours.group(1)) == plans.WINDOW_HOURS


def test_prices_are_formatted_in_reais() -> None:
    assert plans.BY_ID["free"].monthly_price == "Grátis"
    assert plans.BY_ID["pro"].monthly_price == "R$ 59,99"
    assert plans.BY_ID["ultra"].monthly_price == "R$ 179,99"
    # O anual equivale a dez meses: quem paga o ano economiza dois.
    for plan in plans.PLANS:
        if plan.monthly_cents:
            assert plan.yearly_cents == plan.monthly_cents * 10


def test_the_paid_plans_unlock_more_than_the_free_one() -> None:
    free, pro, ultra = (plans.BY_ID[name] for name in ("free", "pro", "ultra"))
    assert free.allowance < pro.allowance < ultra.allowance
    assert not free.coder and pro.coder and ultra.coder
    assert not free.github_write and pro.github_write
    assert free.connector_limit < pro.connector_limit < ultra.connector_limit
    # Um plano desconhecido nunca libera nada por engano.
    assert plans.plan_of("enterprise").id == "free"
    assert plans.plan_of(None).id == "free"


def test_the_catalog_reaches_the_browser_with_the_current_usage(
    make_env: Callable[..., Env],
) -> None:
    env = make_env(FakeProvider(), hourly=10)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        send(client, "Uma pergunta")

        data: dict[str, Any] = client.get("/api/plans").json()
        assert [plan["id"] for plan in data["plans"]] == ["free", "pro", "ultra"]
        assert data["plans"][1]["monthly_price"] == "R$ 59,99"
        # Sem cobrança ligada, a interface não pode fingir que vende.
        assert data["checkout"] is False

        usage = data["usage"]
        assert usage["plan"] == "free"
        # Sem banco com planos, o painel mostra a janela real do servidor.
        assert usage["allowance"] == 10 and usage["consumed"] == 1
        assert usage["features"]["coder"] is False


def test_the_limit_offers_the_next_plan(make_env: Callable[..., Env]) -> None:
    env = make_env(FakeProvider(), hourly=2)
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        send(client, "1")
        send(client, "2")
        response = client.post("/api/chat", json={"content": "3", "client_id": "third-msg-1"})

        assert response.status_code == 429
        body = response.json()
        assert body["error"] == "usage_limit"
        assert body["reset_at"] > time.time()
        assert body["plan"] == "free" and body["plan_name"] == "KAZER"
        # A oferta é o plano de cima, com o quanto de uso a mais ele dá.
        assert body["upgrade"]["id"] == "pro"
        assert body["upgrade"]["price"] == "R$ 59,99"
        # Em português o decimal é vírgula; a interface escreve "6,7×".
        assert body["upgrade"]["times"] == "6,7"


def test_the_wanted_plan_is_saved_without_granting_anything(
    make_env: Callable[..., Env],
) -> None:
    env = make_env(FakeProvider())
    with env.client() as client:
        env.signed_in(client, "ana@example.com")
        saved = client.post("/api/settings", json={"preferences": {"wants_plan": "pro"}})
        assert saved.status_code == 200
        assert saved.json()["preferences"]["wants_plan"] == "pro"

        # Querer não é ter: o plano da conta continua o gratuito.
        assert client.get("/api/plans").json()["usage"]["plan"] == "free"
        # E um valor fora do catálogo é recusado.
        bad = client.post("/api/settings", json={"preferences": {"wants_plan": "patrocinio"}})
        assert (bad.status_code, bad.json()) == (400, {"error": "invalid_request"})
