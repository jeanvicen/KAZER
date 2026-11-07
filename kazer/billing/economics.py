"""Para onde vai cada real de uma assinatura.

A conta é feita no servidor, com números configuráveis, e serve para duas
coisas: mostrar ao dono do KAZER quanto sobra de cada plano e decidir quanto
de crédito de modelos premium cada assinante ganha por mês.

    preço
    − taxa do pagamento (Stripe: % + fixo por cobrança)
    − impostos sobre o faturamento
    − reserva (infra da Vercel/Supabase, o plano grátis, estornos)
    − margem do dono
    = orçamento de API do mês (vira crédito, em dólar, nos modelos premium)

Todos os percentuais vêm do ambiente (KAZER_FEE_PCT, KAZER_TAX_PCT,
KAZER_RESERVE_PCT, KAZER_MARGIN_PCT, KAZER_USD_BRL) porque mudam com o tempo e
com o regime de impostos — confira com seu contador.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Padrões (todos sobrescrevíveis pelo ambiente).
DEFAULT_FEE_PCT = 3.99  # Stripe Brasil, cartão nacional
DEFAULT_FEE_FIXED_CENTS = 39
DEFAULT_TAX_PCT = 6.0  # Simples Nacional, faixa inicial de software (confirme)
DEFAULT_RESERVE_PCT = 5.0  # infraestrutura, usuários grátis e estornos
DEFAULT_MARGIN_PCT = 10.0  # o que fica com o dono
DEFAULT_USD_BRL = 5.50  # câmbio usado para converter o orçamento em dólar


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, "").replace(",", ".") or default)
    except ValueError:
        return default
    return value if value >= 0 else default


@dataclass(frozen=True, slots=True)
class Split:
    """Uma cobrança mensal dividida em partes (tudo em centavos de real)."""

    price_cents: int
    fee_cents: int
    tax_cents: int
    reserve_cents: int
    margin_cents: int
    api_cents: int
    usd_brl: float

    @property
    def api_usd(self) -> float:
        """Orçamento de API do mês, em dólares (é o crédito da pessoa)."""
        return round(self.api_cents / 100 / self.usd_brl, 2)

    def public(self) -> dict[str, float | int]:
        return {
            "preco": self.price_cents / 100,
            "taxa_pagamento": self.fee_cents / 100,
            "impostos": self.tax_cents / 100,
            "reserva": self.reserve_cents / 100,
            "margem": self.margin_cents / 100,
            "orcamento_api_brl": self.api_cents / 100,
            "orcamento_api_usd": self.api_usd,
            "cambio": self.usd_brl,
        }


def split(monthly_cents: int) -> Split:
    """Divide o valor MENSAL de um plano (no anual, use o anual ÷ 12)."""
    if monthly_cents <= 0:
        return Split(0, 0, 0, 0, 0, 0, _env_float("KAZER_USD_BRL", DEFAULT_USD_BRL))
    fee_pct = _env_float("KAZER_FEE_PCT", DEFAULT_FEE_PCT)
    fee_fixed = int(_env_float("KAZER_FEE_FIXED_CENTS", DEFAULT_FEE_FIXED_CENTS))
    tax_pct = _env_float("KAZER_TAX_PCT", DEFAULT_TAX_PCT)
    reserve_pct = _env_float("KAZER_RESERVE_PCT", DEFAULT_RESERVE_PCT)
    margin_pct = _env_float("KAZER_MARGIN_PCT", DEFAULT_MARGIN_PCT)
    usd_brl = _env_float("KAZER_USD_BRL", DEFAULT_USD_BRL) or DEFAULT_USD_BRL

    fee = round(monthly_cents * fee_pct / 100) + fee_fixed
    tax = round(monthly_cents * tax_pct / 100)
    reserve = round(monthly_cents * reserve_pct / 100)
    margin = round(monthly_cents * margin_pct / 100)
    api = max(monthly_cents - fee - tax - reserve - margin, 0)
    return Split(monthly_cents, fee, tax, reserve, margin, api, usd_brl)
