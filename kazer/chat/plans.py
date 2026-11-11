"""Catálogo dos planos do KAZER.

A franquia de cada plano é decidida no banco (`public.kazer_plan_quota`), porque
é lá que a reserva de cota acontece de forma atômica. Este arquivo é o espelho
em Python: nome público, preço e o que cada plano libera. Os dois precisam
contar a mesma história, então a franquia aparece aqui com o mesmo valor e o
teste `test_plans.py` falha se alguém mexer num lado só.

Preço: a cobrança é do Stripe (kazer/integrations/payments.py) e o plano liga
pelo webhook (kazer/billing/stripe_webhook.py). Sem as chaves do Stripe, a
interface avisa em vez de simular uma compra.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Janela de uso, igual à do banco (`kazer_plan_quota` devolve 5 horas).
WINDOW_HOURS = 5


@dataclass(frozen=True)
class Plan:
    """Um plano como a pessoa vê: nome, preço, franquia e o que libera."""

    id: str
    name: str
    tagline: str
    # Centavos para não arrastar erro de ponto flutuante em dinheiro.
    monthly_cents: int
    yearly_cents: int
    allowance: int
    highlights: list[str]
    # Travas que o resto do sistema consulta.
    coder: bool = False
    artifacts: bool = False
    research: bool = False
    github_write: bool = False
    connector_limit: int = 0
    # Imagens concluídas por dia (UTC). Uma por padrão em todo plano: gerar imagem
    # custa GPU, então só o dono aumenta isto, aqui, quando souber o custo.
    images_per_day: int = 1
    # Projetos guardados no Studio.
    design_limit: int = 30
    accent: str = "#8a8f98"
    featured: bool = False
    extras: list[str] = field(default_factory=list)

    @property
    def monthly_price(self) -> str:
        """Preço mensal já formatado em reais."""
        return _brl(self.monthly_cents)

    @property
    def yearly_per_month(self) -> int:
        """Quanto sai o mês quando a pessoa paga o ano inteiro."""
        return round(self.yearly_cents / 12)

    def public(self) -> dict[str, Any]:
        """Forma que a interface consome."""
        return {
            "id": self.id,
            "name": self.name,
            "tagline": self.tagline,
            "monthly_cents": self.monthly_cents,
            "monthly_price": self.monthly_price,
            "yearly_cents": self.yearly_cents,
            "yearly_price": _brl(self.yearly_cents),
            "yearly_per_month": _brl(self.yearly_per_month),
            "allowance": self.allowance,
            "images_per_day": self.images_per_day,
            "design_limit": self.design_limit,
            "window_hours": WINDOW_HOURS,
            "highlights": list(self.highlights),
            "extras": list(self.extras),
            "accent": self.accent,
            "featured": self.featured,
            "features": {
                "coder": self.coder,
                "artifacts": self.artifacts,
                "research": self.research,
                "models": self.monthly_cents > 0,
            },
        }


def _brl(cents: int) -> str:
    """`5999` vira `R$ 59,99`, `179990` vira `R$ 1.799,90`; zero vira `Grátis`."""
    if cents <= 0:
        return "Grátis"
    # `f"{n:,}"` separa com vírgula; em português o milhar é ponto.
    return f"R$ {cents // 100:,}".replace(",", ".") + f",{cents % 100:02d}"


# Pro e Ultra são planos de "todos os modelos": além do KAZ 1.1, a pessoa usa
# Claude, GPT e Kimi pela API de cada empresa, com um crédito mensal que sai do
# próprio preço do plano (ver kazer/billing/economics.py: taxa, imposto,
# reserva e margem saem antes; o resto vira crédito). O anual equivale a dez
# meses (dois de graça), e o crédito é calculado pelo valor mensal do anual,
# para a margem valer nos dois ciclos.
PLANS: tuple[Plan, ...] = (
    Plan(
        id="free",
        name="KAZER",
        tagline="O KAZ 1.1 com imagens, arquivos e memória.",
        monthly_cents=0,
        yearly_cents=0,
        allowance=120,
        accent="#8a8f98",
        highlights=[
            "Conversas com o KAZ 1.1",
            "Imagens e arquivos nas mensagens",
            "Memória e instruções pessoais",
            "Biblioteca de arquivos enviados",
            "Histórico das últimas 100 conversas",
        ],
        connector_limit=0,
    ),
    Plan(
        id="pro",
        name="KAZER Pro",
        tagline="Todos os grandes modelos de IA num lugar só.",
        monthly_cents=159900,
        yearly_cents=1599000,
        allowance=800,
        accent="#d5b15a",
        featured=True,
        coder=True,
        artifacts=True,
        research=True,
        github_write=False,
        connector_limit=0,
        highlights=[
            "Tudo do plano gratuito",
            "Claude Opus, Sonnet e Haiku, GPT e Kimi",
            "Crédito mensal nos modelos premium",
            "Mais de 6 vezes o uso do KAZ 1.1",
            "KZ Code com projetos em .zip e prévia",
            "PDFs e apresentações para baixar",
        ],
        extras=["Prioridade em horários de pico"],
    ),
    Plan(
        id="ultra",
        name="KAZER Ultra",
        tagline="Para quem vive de IA: o máximo de cada modelo.",
        monthly_cents=1000000,
        yearly_cents=10000000,
        allowance=3000,
        accent="#f1dfa5",
        coder=True,
        artifacts=True,
        research=True,
        github_write=False,
        connector_limit=0,
        highlights=[
            "Tudo do Pro",
            "Claude Fable 5.1, o topo da Anthropic",
            "Crédito mensal 6 vezes maior que o do Pro",
            "25 vezes o uso do KAZ 1.1",
            "Sessões longas no KZ Code",
        ],
        extras=["Acesso antecipado a novos recursos", "Suporte por e-mail com prioridade"],
    ),
)

BY_ID: dict[str, Plan] = {plan.id: plan for plan in PLANS}
FREE = BY_ID["free"]


def plan_of(name: str | None) -> Plan:
    """Plano pelo identificador; nome desconhecido cai no gratuito."""
    return BY_ID.get(name or "", FREE)


def catalog() -> list[dict[str, Any]]:
    """Catálogo inteiro na forma que a interface consome."""
    return [plan.public() for plan in PLANS]
