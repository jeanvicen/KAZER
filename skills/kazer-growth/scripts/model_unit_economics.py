#!/usr/bin/env python3
"""
kazer-growth — unit economics from declared assumptions.

Usage:
    python model_unit_economics.py --price 99 --conversion 0.04 \\
        --churn 0.05 --cac 800 --gross-margin 0.8

Outputs LTV, CAC payback (months) and the LTV:CAC ratio, with a verdict
against the usual 3:1 benchmark. Every number traces back to an input —
the assistant must not present a derived figure whose assumption is hidden.
"""

from __future__ import annotations

import argparse
import json


def model(price: float, conversion: float, churn: float, cac: float, gross_margin: float) -> dict:
    if churn <= 0:
        raise ValueError("churn precisa ser maior que zero")
    if conversion <= 0:
        raise ValueError("conversion precisa ser maior que zero")

    lifetime_months = 1 / churn
    gross_profit_per_customer = price * gross_margin
    ltv = gross_profit_per_customer * lifetime_months

    customers_per_100_visits = 100 * conversion
    cac_per_100 = cac * customers_per_100_visits
    blended_cac = cac_per_100 / customers_per_100_visits if customers_per_100_visits else cac

    payback_months = blended_cac / gross_profit_per_customer if gross_profit_per_customer else 0
    ratio = ltv / blended_cac if blended_cac else 0

    if ratio >= 3:
        verdict = "saudável"
        note = "LTV:CAC acima de 3:1 — há espaço para investir em aquisição."
    elif ratio >= 1:
        verdict = "apertado"
        note = "LTV:CAC entre 1:1 e 3:1 — funciona, mas a aquisição não escala ainda."
    else:
        verdict = "quebrado"
        note = "LTV:CAC abaixo de 1:1 — cada cliente novo destrói valor."

    return {
        "ltv": round(ltv, 2),
        "cac": round(blended_cac, 2),
        "payback_months": round(payback_months, 1),
        "ltv_cac_ratio": round(ratio, 2),
        "lifetime_months": round(lifetime_months, 1),
        "verdict": verdict,
        "note": note,
        "assumptions": {
            "price": price,
            "conversion": conversion,
            "monthly_churn": churn,
            "cac": cac,
            "gross_margin": gross_margin,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Model unit economics.")
    parser.add_argument("--price", type=float, required=True)
    parser.add_argument("--conversion", type=float, required=True)
    parser.add_argument("--churn", type=float, required=True)
    parser.add_argument("--cac", type=float, required=True)
    parser.add_argument("--gross-margin", type=float, default=0.8)
    args = parser.parse_args()

    result = model(
        args.price,
        args.conversion,
        args.churn,
        args.cac,
        args.gross_margin,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
