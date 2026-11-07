"""Cobrança das assinaturas do KAZER (pronta para o Stripe).

Para ligar, defina no servidor (nunca no navegador):
- STRIPE_SECRET_KEY            chave secreta (sk_live_... / sk_test_...);
- STRIPE_PRICE_PRO_MENSAL, STRIPE_PRICE_PRO_ANUAL,
  STRIPE_PRICE_ULTRA_MENSAL, STRIPE_PRICE_ULTRA_ANUAL  IDs de preço (price_...).

Com isso, a tela de planos troca o "avise-me" por um botão que abre o Checkout
hospedado do Stripe (cartão, Pix e boleto, conforme o painel). Quem decide o
plano e o preço é o servidor: o navegador só manda `plan` e `cycle`, e o ID do
preço vem da configuração. A ativação do plano depois do pagamento chega pelo
webhook do Stripe (`kazer/billing/stripe_webhook.py`, rota /api/stripe/webhook),
que ativa, renova e cancela o plano em `kazer_plans`.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass

import httpx

from kazer.security.secrets import EnvironmentSecretProvider, SecretProvider

logger = logging.getLogger("kazer.payments")

PLANS = frozenset({"pro", "ultra"})
CYCLES = frozenset({"mensal", "anual"})


class CheckoutError(Exception):
    """Falha ao abrir o pagamento; nunca carrega chave nem corpo do provedor."""


@dataclass(frozen=True, slots=True)
class StripeCheckout:
    """Cria sessões do Checkout hospedado do Stripe."""

    secret_key: str
    prices: Mapping[str, str]
    public_origin: str
    client: httpx.Client | None = None

    def __repr__(self) -> str:
        """Sem chave."""
        return "StripeCheckout()"

    def available(self, plan: str, cycle: str) -> bool:
        return bool(self.prices.get(f"{plan}_{cycle}"))

    def create(self, *, user_id: str, email: str, plan: str, cycle: str) -> str:
        """Devolve a URL do pagamento (https://checkout.stripe.com/...)."""
        if plan not in PLANS or cycle not in CYCLES:
            raise CheckoutError("invalid_plan")
        price = self.prices.get(f"{plan}_{cycle}")
        if not price:
            raise CheckoutError("price_missing")
        origin = self.public_origin.rstrip("/")
        form = {
            "mode": "subscription",
            "line_items[0][price]": price,
            "line_items[0][quantity]": "1",
            "client_reference_id": user_id,
            "customer_email": email,
            "allow_promotion_codes": "true",
            "locale": "pt-BR",
            "metadata[kazer_plan]": plan,
            "metadata[kazer_cycle]": cycle,
            "subscription_data[metadata][kazer_user]": user_id,
            # A renovação (invoice.paid) precisa saber o plano sem consultar nada.
            "subscription_data[metadata][kazer_plan]": plan,
            "success_url": f"{origin}/?assinatura=ok",
            "cancel_url": f"{origin}/?assinatura=cancelada",
        }
        client = self.client or httpx.Client(timeout=15.0)
        try:
            response = client.post(
                "https://api.stripe.com/v1/checkout/sessions",
                data=form,
                headers={"Authorization": f"Bearer {self.secret_key}"},
            )
        except httpx.HTTPError:
            raise CheckoutError("unreachable") from None
        if response.status_code != 200:
            logger.warning("payments.checkout_rejected", extra={"status": response.status_code})
            raise CheckoutError("rejected")
        url = response.json().get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise CheckoutError("rejected")
        return url


def build_checkout(
    prices: Mapping[str, str], public_origin: str, secrets: SecretProvider | None = None
) -> StripeCheckout | None:
    """Stripe configurado, ou None (a tela mostra "avise-me", sem fingir venda)."""
    if not prices:
        return None
    try:
        key = (secrets or EnvironmentSecretProvider()).get_secret(
            "STRIPE_SECRET_KEY", scope="payments"
        )
    except LookupError:
        return None
    return StripeCheckout(key, dict(prices), public_origin)
