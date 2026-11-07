"""Cobrança: economia dos planos, webhook do Stripe, modelos premium e créditos.

Prova o caminho inteiro sem chave de verdade: o pagamento confirmado pelo
Stripe liga o Pro; o Pro libera o Claude; cada resposta desconta do crédito do
mês numa tabela que o usuário não escreve; quando acaba, o premium trava e o
KAZ 1.1 continua funcionando.
"""

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from kazer.billing import catalog, credits, economics, stripe_webhook
from kazer.chat import plans
from tests.test_chat import Env, FakeProvider, send

SECRET = "whsec_teste_que_nunca_vaza"


@pytest.fixture
def make_env(tmp_path: Path) -> Callable[..., Env]:
    def build(provider: FakeProvider | None = None, **kwargs: Any) -> Env:
        return Env(tmp_path, provider, **kwargs)

    return build


def signed(
    payload: dict[str, Any], secret: str = SECRET, stamp: int | None = None
) -> tuple[bytes, str]:
    body = json.dumps(payload).encode()
    t = stamp or int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return body, f"t={t},v1={sig}"


# ---------- Economia ----------


def test_every_real_of_the_price_is_accounted_for() -> None:
    for plan in plans.PLANS:
        if not plan.monthly_cents:
            continue
        part = economics.split(plan.yearly_per_month)
        total = part.fee_cents + part.tax_cents + part.reserve_cents + part.margin_cents
        assert total + part.api_cents == part.price_cents
        assert part.margin_cents == round(part.price_cents * 0.10)
        assert part.api_usd > 0
    pro = economics.split(plans.BY_ID["pro"].yearly_per_month).api_usd
    ultra = economics.split(plans.BY_ID["ultra"].yearly_per_month).api_usd
    assert ultra > 6 * pro


def test_margins_follow_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KAZER_MARGIN_PCT", "30")
    part = economics.split(100_000)
    assert part.margin_cents == 30_000


def test_prices_can_be_corrected_without_a_deploy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KAZER_MODEL_PRICES", '{"gpt": [1, 2], "kimi": "lixo"}')
    gpt = catalog.find("gpt")
    assert gpt is not None and (gpt.input_per_m, gpt.output_per_m) == (1.0, 2.0)
    assert catalog.find("kimi").input_per_m == 0.95  # type: ignore[union-attr]
    opus = catalog.find("claude-opus-5-5")
    assert opus is not None and opus.cost_usd(1_000_000, 1_000_000) == 24.0


def test_credit_state_only_shows_percentages() -> None:
    state = credits.state(credits.to_micro(50), 200.0, "2026-11")
    assert state["used_pct"] == 25.0 and not state["exhausted"]
    assert credits.state(credits.to_micro(200), 200.0, "2026-11")["exhausted"]


# ---------- Webhook do Stripe ----------


def test_webhook_signature_is_required_and_checked() -> None:
    event = {"type": "invoice.paid", "data": {"object": {}}}
    body, header = signed(event)
    assert stripe_webhook.verify(body, header, SECRET)["type"] == "invoice.paid"
    for bad in (header.replace("v1=", "v1=0"), "", f"t={int(time.time())}"):
        with pytest.raises(stripe_webhook.WebhookError):
            stripe_webhook.verify(body, bad, SECRET)
    old_body, old = signed(event, stamp=int(time.time()) - 3600)
    with pytest.raises(stripe_webhook.WebhookError):
        stripe_webhook.verify(old_body, old, SECRET)  # reenvio antigo


def test_paid_renewed_and_cancelled_events_change_the_plan() -> None:
    user = "3f2c1d4e-1111-4abc-9def-0123456789ab"
    done = stripe_webhook.plan_change({"type": "checkout.session.completed", "data": {"object": {
        "client_reference_id": user, "payment_status": "paid",
        "metadata": {"kazer_plan": "pro", "kazer_cycle": "mensal"}}}}, now=0)
    assert done == stripe_webhook.PlanChange(user, "pro", 31 * 86400)
    renewed = stripe_webhook.plan_change({"type": "invoice.paid", "data": {"object": {
        "parent": {"subscription_details": {
            "metadata": {"kazer_user": user, "kazer_plan": "ultra"}}},
        "lines": {"data": [{"period": {"end": 999}}]}}}})
    assert renewed == stripe_webhook.PlanChange(user, "ultra", 999)
    gone = stripe_webhook.plan_change({"type": "customer.subscription.deleted",
                                       "data": {"object": {"metadata": {"kazer_user": user}}}})
    assert gone == stripe_webhook.PlanChange(user, "free", None)
    forged = stripe_webhook.plan_change({"type": "checkout.session.completed", "data": {"object": {
        "client_reference_id": user, "metadata": {"kazer_plan": "admin"}}}})
    assert forged is None


# ---------- Modelos premium e créditos (ponta a ponta) ----------


def premium_env(make_env: Callable[..., Env]) -> tuple[Env, FakeProvider]:
    env = make_env(FakeProvider(chunks=("Resposta do KAZ 1.1",)))
    fake = FakeProvider(chunks=("Resposta do Claude " * 50,))
    env.chat._premium_factory = lambda model: fake if model.id.startswith("claude") else None
    return env, fake


def user_id(env: Env, email: str) -> str:
    user = env.auth._store.find_user_by_email(email)
    assert user is not None
    return user.id


def test_free_plan_cannot_pick_a_premium_model(make_env: Callable[..., Env]) -> None:
    env, _ = premium_env(make_env)
    with env.client() as client:
        env.signed_in(client, "free@example.com")
        response = client.post(
            "/api/chat",
            json={"content": "Oi", "client_id": "premium-free-0001", "model": "claude-opus-5-5"},
        )
        assert (response.status_code, response.json()["error"]) == (402, "plan_required")
        listed = client.get("/api/models").json()
        opus = next(m for m in listed["models"] if m["id"] == "claude-opus-5-5")
        assert opus["allowed"] is False and listed["credits"] is None
        bad = client.post(
            "/api/chat", json={"content": "Oi", "client_id": "premium-free-0002", "model": "gpt-99"}
        )
        assert bad.json()["error"] == "invalid_model"


def test_pro_uses_claude_spends_credit_and_locks_when_it_ends(
    make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    env, fake = premium_env(make_env)
    with env.client() as client:
        env.signed_in(client, "pro@example.com")
        uid = user_id(env, "pro@example.com")
        # Pagamento confirmado pelo Stripe: o plano liga.
        body, header = signed({"type": "checkout.session.completed", "data": {"object": {
            "client_reference_id": uid, "payment_status": "paid",
            "metadata": {"kazer_plan": "pro", "kazer_cycle": "mensal"}}}})
        hook = client.post("/api/stripe/webhook", content=body,
                           headers={"Stripe-Signature": header, "Content-Type": "application/json",
                                    "Origin": "https://stripe.com"})
        assert hook.status_code == 200, hook.text
        assert client.get("/api/models").json()["plan"] == "pro"

        events = send(client, "Explique", model="claude-opus-5-5")
        assert "Resposta do Claude" in events[-1]["reply"]["content"]
        assert fake.requests and fake.requests[-1].effort == "high"
        # Cobrou (centavos de dólar numa resposta curta) na tabela do servidor.
        assert env.chat.credit_state(uid)["spent_usd"] > 0

        # Gasta o mês inteiro: o premium trava, o KAZ 1.1 continua.
        month = credits.month_key()
        env.chat._store.charge_credits(uid, month, credits.to_micro(10_000))
        locked = client.post(
            "/api/chat",
            json={"content": "Oi", "client_id": "premium-pro-lock-02", "model": "claude-opus-5-5"},
        )
        assert (locked.status_code, locked.json()["error"]) == (402, "credits_exhausted")
        assert "KAZ 1.1" in send(client, "Oi de novo")[-1]["reply"]["content"]


def test_webhook_without_valid_signature_changes_nothing(
    make_env: Callable[..., Env], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    env, _ = premium_env(make_env)
    with env.client() as client:
        body, header = signed({"type": "checkout.session.completed"}, secret="whsec_falso")
        response = client.post("/api/stripe/webhook", content=body,
                               headers={"Stripe-Signature": header})
        assert response.status_code == 400
