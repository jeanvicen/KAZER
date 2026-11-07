"""Webhook do Stripe: o pagamento caiu → o plano liga; cancelou → volta ao grátis.

Configure no painel do Stripe um endpoint para
    https://SEU-DOMINIO/api/stripe/webhook
com os eventos `checkout.session.completed`, `invoice.paid` e
`customer.subscription.deleted`, e copie o "Signing secret" (whsec_...) para a
variável STRIPE_WEBHOOK_SECRET.

Toda chamada é conferida pela assinatura HMAC-SHA256 do Stripe (cabeçalho
`Stripe-Signature`), com tolerância de 5 minutos contra reenvio. Sem assinatura
válida, nada muda. O id da conta vem de `client_reference_id`/metadata que o
próprio servidor colocou ao criar o checkout — nunca do navegador.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any

TOLERANCE = 300
PAID = frozenset({"pro", "ultra"})


class WebhookError(Exception):
    """Assinatura inválida ou corpo ilegível."""


@dataclass(frozen=True, slots=True)
class PlanChange:
    user_id: str
    plan: str
    renews_at: int | None


def verify(payload: bytes, header: str, secret: str, now: float | None = None) -> dict[str, Any]:
    """Confere a assinatura e devolve o evento."""
    if not secret or not header:
        raise WebhookError("sem assinatura")
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        key, _, value = item.strip().partition("=")
        parts.setdefault(key, []).append(value)
    try:
        stamp = int(parts.get("t", [""])[0])
    except ValueError:
        raise WebhookError("assinatura malformada") from None
    current = time.time() if now is None else now
    if abs(current - stamp) > TOLERANCE:
        raise WebhookError("assinatura vencida")
    signed = f"{stamp}.".encode() + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, given) for given in parts.get("v1", [])):
        raise WebhookError("assinatura não confere")
    try:
        event = json.loads(payload)
    except ValueError:
        raise WebhookError("corpo ilegível") from None
    if not isinstance(event, dict):
        raise WebhookError("corpo ilegível")
    return event


def _meta(obj: dict[str, Any], *paths: tuple[str, ...]) -> dict[str, Any]:
    """Metadata em qualquer um dos caminhos (a API do Stripe muda de versão)."""
    for path in paths:
        node: Any = obj
        for key in path:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict) and node:
            return node
    return {}


def plan_change(event: dict[str, Any], now: float | None = None) -> PlanChange | None:
    """O que o evento muda no plano (None = evento que não interessa)."""
    kind = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if not isinstance(obj, dict):
        return None
    current = int(time.time() if now is None else now)
    if kind == "checkout.session.completed":
        meta = obj.get("metadata") or {}
        user = str(obj.get("client_reference_id") or "")
        plan = str(meta.get("kazer_plan") or "")
        cycle = str(meta.get("kazer_cycle") or "mensal")
        if not user or plan not in PAID or obj.get("payment_status") not in ("paid", None):
            return None
        days = 366 if cycle == "anual" else 31
        return PlanChange(user, plan, current + days * 86400)
    if kind == "invoice.paid":
        meta = _meta(
            obj,
            ("subscription_details", "metadata"),
            ("parent", "subscription_details", "metadata"),
            ("metadata",),
        )
        user, plan = str(meta.get("kazer_user") or ""), str(meta.get("kazer_plan") or "")
        if not user or plan not in PAID:
            return None
        ends = [
            int((line.get("period") or {}).get("end") or 0)
            for line in ((obj.get("lines") or {}).get("data") or [])
            if isinstance(line, dict)
        ]
        renews = max(ends, default=0) or current + 31 * 86400
        return PlanChange(user, plan, renews)
    if kind == "customer.subscription.deleted":
        user = str((obj.get("metadata") or {}).get("kazer_user") or "")
        return PlanChange(user, "free", None) if user else None
    return None
