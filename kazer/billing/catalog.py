"""Modelos premium dos planos Pro e Ultra.

O KAZ 1.1 (Groq) continua sendo o modelo de todo mundo e não gasta crédito.
Os modelos abaixo usam a API de cada empresa com a SUA chave, e cada resposta
desconta do crédito mensal da pessoa o custo real estimado (tokens × preço).

Preços em dólar por 1 milhão de tokens (entrada, saída):
- Claude: tabela oficial da Anthropic (out/2026).
- GPT e Kimi: valores de referência — CONFIRA na página de preços de cada
  empresa e ajuste por KAZER_MODEL_PRICES sem precisar de deploy de código:
  KAZER_MODEL_PRICES='{"gpt": [5, 30], "kimi": [0.95, 4]}'
O ID do modelo de cada empresa também muda com o tempo:
  KAZER_OPENAI_MODEL=gpt-5.5   KAZER_KIMI_MODEL=kimi-k2.6
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("kazer.billing")

ANTHROPIC = "anthropic"
OPENAI = "openai"
MOONSHOT = "moonshot"

KEYS = {ANTHROPIC: "ANTHROPIC_API_KEY", OPENAI: "OPENAI_API_KEY", MOONSHOT: "MOONSHOT_API_KEY"}
BASE_URLS = {OPENAI: "https://api.openai.com/v1", MOONSHOT: "https://api.moonshot.ai/v1"}


@dataclass(frozen=True, slots=True)
class PremiumModel:
    id: str  # o que o navegador manda (nunca o ID interno da empresa)
    label: str
    maker: str  # quem fez, para a interface
    provider: str
    upstream: str  # ID na API da empresa
    input_per_m: float  # US$ por 1M tokens de entrada
    output_per_m: float  # US$ por 1M tokens de saída
    plans: tuple[str, ...]
    blurb: str
    images: bool = True

    def cost_usd(self, input_tokens: int, output_tokens: int) -> float:
        return (input_tokens * self.input_per_m + output_tokens * self.output_per_m) / 1_000_000

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "maker": self.maker,
            "blurb": self.blurb,
            "plans": list(self.plans),
            "premium": True,
        }


def _models() -> tuple[PremiumModel, ...]:
    paid = ("pro", "ultra")
    openai_model = os.environ.get("KAZER_OPENAI_MODEL", "").strip() or "gpt-5.5"
    kimi_model = os.environ.get("KAZER_KIMI_MODEL", "").strip() or "kimi-k2.6"
    return (
        PremiumModel("claude-haiku-5-5", "Claude Haiku 5.5", "Anthropic", ANTHROPIC,
                     "claude-haiku-5-5", 0.10, 0.50, paid, "Rápido e econômico."),
        PremiumModel("claude-sonnet-5-5", "Claude Sonnet 5.5", "Anthropic", ANTHROPIC,
                     "claude-sonnet-5-5", 2.00, 10.00, paid, "Ótimo em código e no dia a dia."),
        PremiumModel("claude-opus-5-5", "Claude Opus 5.5", "Anthropic", ANTHROPIC,
                     "claude-opus-5-5", 4.00, 20.00, paid, "O mais inteligente para o trabalho."),
        PremiumModel("claude-fable-5-1", "Claude Fable 5.1", "Anthropic", ANTHROPIC,
                     "claude-fable-5-1", 10.00, 50.00, ("ultra",),
                     "O topo da Anthropic, para os problemas mais difíceis."),
        PremiumModel("gpt", "GPT", "OpenAI", OPENAI, openai_model, 5.00, 30.00, paid,
                     "O modelo mais recente da OpenAI."),
        PremiumModel("kimi", "Kimi", "Moonshot AI", MOONSHOT, kimi_model, 0.95, 4.00, paid,
                     "Bom em código e textos longos, barato.", images=False),
    )


def _overrides() -> dict[str, tuple[float, float]]:
    raw = os.environ.get("KAZER_MODEL_PRICES", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("billing.bad_model_prices")
        return {}
    out: dict[str, tuple[float, float]] = {}
    if isinstance(data, dict):
        for key, value in data.items():
            if (
                isinstance(key, str)
                and isinstance(value, list)
                and len(value) == 2
                and all(isinstance(v, int | float) and v >= 0 for v in value)
            ):
                out[key] = (float(value[0]), float(value[1]))
    return out


def catalog() -> tuple[PremiumModel, ...]:
    """Os modelos premium com os preços já ajustados pelo ambiente."""
    prices = _overrides()
    models = []
    for model in _models():
        if model.id in prices:
            inp, out = prices[model.id]
            model = PremiumModel(
                model.id, model.label, model.maker, model.provider, model.upstream,
                inp, out, model.plans, model.blurb, model.images,
            )
        models.append(model)
    return tuple(models)


def find(model_id: str) -> PremiumModel | None:
    return next((model for model in catalog() if model.id == model_id), None)


def key_configured(model: PremiumModel) -> bool:
    """A chave da empresa deste modelo está no servidor?"""
    return bool(os.environ.get(KEYS[model.provider], "").strip())
