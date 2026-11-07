"""Crédito mensal dos modelos premium (o extrato de cada conta).

O crédito de um mês é o orçamento de API do plano (ver `economics`). Cada
resposta de um modelo premium desconta o custo estimado; quando acaba, os
modelos premium travam até o mês virar — o KAZ 1.1 continua liberado.

O gasto fica numa tabela que só o servidor escreve (`kazer_credit_usage` no
Supabase, `credit_usage` no SQLite local): a pessoa não consegue "zerar" o
próprio gasto. Valores em micro-dólares (inteiros), sem erro de arredondamento.
"""

from __future__ import annotations

import time
from typing import Any

MICRO = 1_000_000


def month_key(now: float | None = None) -> str:
    return time.strftime("%Y-%m", time.gmtime(now if now is not None else time.time()))


def to_micro(usd: float) -> int:
    return max(int(round(usd * MICRO)), 0)


def state(spent_micro: int, budget_usd: float, month: str) -> dict[str, Any]:
    """Quanto do mês já foi usado (a interface mostra só a porcentagem)."""
    budget = to_micro(budget_usd)
    spent = max(spent_micro, 0)
    return {
        "month": month,
        "used_pct": min(round(spent * 100 / budget, 1), 100.0) if budget else 100.0,
        "exhausted": spent >= budget,
        "budget_usd": round(budget_usd, 2),
        "spent_usd": round(spent / MICRO, 4),
    }
