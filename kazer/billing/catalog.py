"""Modelos premium dos planos Pro e Ultra.

O KAZ 1.1 (Groq) continua sendo o modelo de todo mundo e não gasta crédito.
Os modelos abaixo usam a API de cada empresa com a SUA chave, e cada resposta
desconta do crédito mensal da pessoa o custo real estimado (tokens × preço).

Preços em dólar por 1 milhão de tokens (entrada, saída):
- Claude: tabela oficial da Anthropic (out/2026).
- GPT e os modelos abertos: valores de referência — CONFIRA na página de preços
  de cada empresa e ajuste por KAZER_MODEL_PRICES sem precisar de deploy de código:
  KAZER_MODEL_PRICES='{"gpt": [5, 30], "kimi": [2, 10]}'
O ID do modelo de cada empresa também muda com o tempo:
  KAZER_OPENAI_MODEL=gpt-5.5   KAZER_KIMI_MODEL=...   KAZER_DEEPSEEK_MODEL=...
  KAZER_GLM_MODEL=...

Modelos abertos (pesquisa de nov/2026, docs/MODELOS-ABERTOS.md):
- Kimi K3.1 Pro: o melhor aberto em código e jogos. Vai pelo OpenRouter
  (OPENROUTER_API_KEY). Quem só tem MOONSHOT_API_KEY continua no Kimi direto da
  Moonshot, como antes: nada muda para um servidor já configurado.
- DeepSeek V4.1 Flash: o custo-benefício. API oficial (DEEPSEEK_API_KEY) ou, sem
  ela, OpenRouter. Cobrado pelo preço de pico (o dobro do fora de pico), para o
  crédito nunca sair menor que a conta.
- GLM-5.3: tarefas longas de código. Só pelo OpenRouter.
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
DEEPSEEK = "deepseek"
OPENROUTER = "openrouter"

KEYS = {
    ANTHROPIC: "ANTHROPIC_API_KEY",
    OPENAI: "OPENAI_API_KEY",
    MOONSHOT: "MOONSHOT_API_KEY",
    DEEPSEEK: "DEEPSEEK_API_KEY",
    OPENROUTER: "OPENROUTER_API_KEY",
}
BASE_URLS = {
    OPENAI: "https://api.openai.com/v1",
    MOONSHOT: "https://api.moonshot.ai/v1",
    DEEPSEEK: "https://api.deepseek.com/v1",
    OPENROUTER: "https://openrouter.ai/api/v1",
}
# Campo em que cada provedor aceita o raciocínio de volta nos turnos de
# ferramenta. OpenAI e Moonshot direto ficam de fora (o Kimi antigo não pensa).
REASONING_FIELDS = {DEEPSEEK: "reasoning_content", OPENROUTER: "reasoning"}
# Modelos que pensam antes de responder gastam muita saída só no raciocínio
# (o Kimi K3.1 Pro passa de 50 mil tokens numa tarefa grande): teto folgado.
THINKER_MAX_OUTPUT = 32_768


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
    # Teto de saída pedido à API (raciocínio + resposta).
    max_output: int = 16_384

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
        _kimi(paid),
        _deepseek(paid),
        PremiumModel("glm", "GLM-5.3", "Z.ai", OPENROUTER,
                     os.environ.get("KAZER_GLM_MODEL", "").strip() or "z-ai/glm-5.3",
                     1.40, 4.40, paid, "Aberto, firme em tarefas longas de código.",
                     images=False, max_output=THINKER_MAX_OUTPUT),
    )


def _has(provider: str) -> bool:
    return bool(os.environ.get(KEYS[provider], "").strip())


def _kimi(paid: tuple[str, ...]) -> PremiumModel:
    """Kimi K3.1 Pro pelo OpenRouter; só com a chave da Moonshot, o Kimi de antes."""
    chosen = os.environ.get("KAZER_KIMI_MODEL", "").strip()
    if _has(MOONSHOT) and not _has(OPENROUTER):
        return PremiumModel("kimi", "Kimi", "Moonshot AI", MOONSHOT, chosen or "kimi-k2.6",
                            0.95, 4.00, paid, "Bom em código e textos longos, barato.",
                            images=False)
    # ":floor" manda o OpenRouter escolher o provedor mais barato do momento;
    # a cobrança usa o preço de tabela da Moonshot (o teto), nunca o piso.
    return PremiumModel("kimi", "Kimi K3.1 Pro", "Moonshot AI", OPENROUTER,
                        chosen or "moonshotai/kimi-k3.1-pro:floor", 2.00, 10.00, paid,
                        "O melhor modelo aberto para código e jogos.",
                        max_output=THINKER_MAX_OUTPUT)


def _deepseek(paid: tuple[str, ...]) -> PremiumModel:
    """DeepSeek V4.1 Flash: API oficial quando há chave; senão, OpenRouter."""
    chosen = os.environ.get("KAZER_DEEPSEEK_MODEL", "").strip()
    direct = _has(DEEPSEEK) or not _has(OPENROUTER)
    return PremiumModel(
        "deepseek", "DeepSeek V4.1 Flash", "DeepSeek", DEEPSEEK if direct else OPENROUTER,
        chosen or ("deepseek-flash" if direct else "deepseek/deepseek-v4.1-flash"),
        0.30, 1.20, paid, "Aberto, rápido e muito barato: rende o crédito.",
        max_output=THINKER_MAX_OUTPUT,
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
                model.max_output,
            )
        models.append(model)
    return tuple(models)


def find(model_id: str) -> PremiumModel | None:
    return next((model for model in catalog() if model.id == model_id), None)


def key_configured(model: PremiumModel) -> bool:
    """A chave da empresa deste modelo está no servidor?"""
    return bool(os.environ.get(KEYS[model.provider], "").strip())
