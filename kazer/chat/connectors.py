"""Conectores do KAZER: por enquanto, o GitHub.

Um conector é um serviço externo que o KAZER sabe usar em nome da conta. Cada um
tem endereço **fixo no servidor**: a pessoa nunca informa uma URL. Isso fecha a
porta para o KAZER ser usado como ponte até endereços internos ou aleatórios, e
deixa claro com quem ele está falando.

O GitHub fala MCP em `https://api.githubcopilot.com/mcp/`, com a credencial no
cabeçalho `Authorization: Bearer`. Regras de plano, como o produto promete:

* **Leitura** vale em qualquer plano: ver repositórios, arquivos, issues e PRs.
* **Escrita** (abrir PR, enviar commit, comentar) pede o plano Pro. No gratuito o
  KAZER manda `X-MCP-Readonly: true`, e o próprio GitHub só serve ferramentas
  de leitura — além disso o servidor do KAZER recusa a ferramenta de escrita
  antes de chamar, para não depender de um lado só.
* **Custo**: cada chamada soma `weight` à franquia, além da mensagem.

Novos conectores entram aqui, um a um, quando tiverem credencial e teste de
verdade — o catálogo não finge ter o que não tem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Pesos: quanto cada chamada de conector soma à cota, além do custo da mensagem.
WEIGHT_LIGHT = 1
WEIGHT_MEDIUM = 2
WEIGHT_HEAVY = 4


@dataclass(frozen=True, slots=True)
class Connector:
    """Um serviço que o KAZER sabe usar, com endereço e regra de plano próprios."""

    id: str
    name: str
    description: str
    # Endereço MCP fixo. Só https; nunca vem do navegador.
    endpoint: str
    # Plano que libera a escrita (só para a interface dizer qual) e o recurso do
    # plano que o servidor confere. Sem recurso: ninguém escreve.
    write_plan: str
    write_feature: str
    weight: int
    # Onde a pessoa cria a credencial, e o que escrever no campo.
    token_url: str
    token_label: str
    token_help: str

    def can_write(self, plan_features: dict[str, Any]) -> bool:
        """Este plano pode usar ferramentas de escrita neste conector?"""
        return bool(self.write_feature) and bool(plan_features.get(self.write_feature))

    def headers(self, plan_features: dict[str, Any]) -> dict[str, str]:
        """Cabeçalhos extras da chamada: leitura obrigatória quando o plano não escreve."""
        if self.id == "github" and not self.can_write(plan_features):
            return {"X-MCP-Readonly": "true"}
        return {}

    def public(self, plan_features: dict[str, Any]) -> dict[str, Any]:
        """O que a interface vê; o endereço e a credencial nunca saem daqui."""
        limit = int(plan_features.get("connector_limit") or 0)
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "weight": self.weight,
            "write_plan": self.write_plan,
            "can_read": limit > 0,
            "can_write": self.can_write(plan_features),
            "token_url": self.token_url,
            "token_label": self.token_label,
            "token_help": self.token_help,
        }


CATALOG: tuple[Connector, ...] = (
    Connector(
        id="github",
        name="GitHub",
        description="Ler repositórios, arquivos, issues e pull requests da sua conta.",
        endpoint="https://api.githubcopilot.com/mcp/",
        write_plan="pro",
        write_feature="github_write",
        weight=WEIGHT_MEDIUM,
        token_url="https://github.com/settings/personal-access-tokens/new",
        token_label="Token de acesso do GitHub",
        token_help=(
            "Crie um token fine-grained só com as permissões que quer dar. "
            "Para só ler, deixe tudo como leitura (Contents, Issues e Pull requests: Read-only)."
        ),
    ),
)
BY_ID: dict[str, Connector] = {item.id: item for item in CATALOG}


def weight_of(ids: list[str]) -> int:
    """Quanto os conectores de um pedido somam à cota."""
    return sum(BY_ID[item].weight for item in ids if item in BY_ID)
