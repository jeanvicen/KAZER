"""Catálogo dos planos do KAZER.

A franquia de cada plano é decidida no banco (`public.kazer_plan_quota`), porque
é lá que a reserva de cota acontece de forma atômica. Este arquivo é o espelho
em Python: nome público, preço e o que cada plano libera. Os dois precisam
contar a mesma história, então a franquia aparece aqui com o mesmo valor e o
teste `test_plans.py` falha se alguém mexer num lado só.

Preço: o KAZER ainda não tem cobrança ligada. Os valores abaixo são os preços
anunciados; enquanto o pagamento não abrir, a interface diz isso em vez de
simular uma compra.
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
    connector_limit: int = 3
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
            "window_hours": WINDOW_HOURS,
            "highlights": list(self.highlights),
            "extras": list(self.extras),
            "accent": self.accent,
            "featured": self.featured,
            "features": {
                "coder": self.coder,
                "artifacts": self.artifacts,
                "research": self.research,
                "github_write": self.github_write,
                "connector_limit": self.connector_limit,
            },
        }


def _brl(cents: int) -> str:
    """`5999` vira `R$ 59,99`, `179990` vira `R$ 1.799,90`; zero vira `Grátis`."""
    if cents <= 0:
        return "Grátis"
    # `f"{n:,}"` separa com vírgula; em português o milhar é ponto.
    return f"R$ {cents // 100:,}".replace(",", ".") + f",{cents % 100:02d}"


# Preços escolhidos olhando o mercado brasileiro em outubro de 2026: ChatGPT Go
# a R$ 39,99, ChatGPT Plus a R$ 99,90 e Claude Pro a R$ 110 por mês. O Pro do
# KAZER fica abaixo dos dois grandes, e o Ultra abaixo do ChatGPT Pro
# (a partir de R$ 525). O anual equivale a dez meses: dois de graça.
PLANS: tuple[Plan, ...] = (
    Plan(
        id="free",
        name="KAZER",
        tagline="Para conhecer e usar todo dia, sem pagar nada.",
        monthly_cents=0,
        yearly_cents=0,
        allowance=120,
        accent="#8a8f98",
        highlights=[
            "Conversa completa com o KAZ 1.1",
            "Imagens, PDFs e arquivos na conversa",
            "Memória por conta e personalização",
            "Biblioteca com o que você enviou",
            "Histórico das 100 conversas mais recentes",
        ],
        extras=["Conectores de leitura (até 3)"],
        connector_limit=3,
    ),
    Plan(
        id="pro",
        name="KAZER Pro",
        tagline="Para quem usa o KAZER para trabalhar.",
        monthly_cents=5999,
        yearly_cents=59990,
        allowance=800,
        accent="#5b8cff",
        featured=True,
        coder=True,
        artifacts=True,
        research=True,
        github_write=True,
        connector_limit=50,
        highlights=[
            "Tudo do plano gratuito",
            "Mais de 6 vezes o uso por janela",
            "Modo Forja: programar de verdade",
            "Artefatos: páginas, componentes e documentos",
            "Pesquisa profunda em várias etapas",
            "GitHub com escrita, não só leitura",
        ],
        extras=["Até 50 conectores", "Fila de prioridade quando o servidor lota"],
    ),
    Plan(
        id="ultra",
        name="KAZER Ultra",
        tagline="Para quem leva o KAZER ao limite todo dia.",
        monthly_cents=17999,
        yearly_cents=179990,
        allowance=3000,
        accent="#c084fc",
        coder=True,
        artifacts=True,
        research=True,
        github_write=True,
        connector_limit=500,
        highlights=[
            "Tudo do Pro",
            "25 vezes o uso do plano gratuito",
            "Pensamento profundo sem contar o dobro",
            "Sessões longas de Forja sem interrupção",
            "Todos os conectores do catálogo",
        ],
        extras=["Novidades antes de todo mundo", "Suporte direto com o time"],
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
