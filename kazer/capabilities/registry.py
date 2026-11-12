"""Registro de capacidades: um lugar só que diz o que o KAZER faz, para quem e a que custo.

Regra de ouro: **só entra aqui o que existe**. Cada capacidade `available`
aponta para rotas e módulos reais e para o arquivo de teste que a cobre;
`tests/test_capabilities.py` quebra se um desses apontamentos for inventado.
Ideias e pesquisa ficam em `docs/roadmap/capability-catalog.md`, não aqui.

Estados:
- `available`: funciona hoje, para os planos listados.
- `needs_config`: o código está pronto, mas depende de algo que o dono liga
  (um provedor, uma chave, uma migração). A tela mostra como indisponível.
- `paused`: existe, mas está desligada de propósito.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Status = Literal["available", "needs_config", "paused"]
Family = Literal[
    "conversa",
    "pesquisa",
    "escrita",
    "documentos",
    "apresentacoes",
    "imagens",
    "dados",
    "codigo",
    "voz",
    "memoria",
    "conta",
]
# Classe de custo de cada uso: ajuda a decidir limite e plano.
Cost = Literal["nenhum", "modelo_leve", "modelo", "modelo_premium", "cpu", "gpu", "armazenamento"]
ALL_PLANS = ("free", "pro", "ultra")
PAID_PLANS = ("pro", "ultra")


@dataclass(frozen=True, slots=True)
class Capability:
    id: str
    name: str
    summary: str
    family: Family
    status: Status = "available"
    plans: tuple[str, ...] = ALL_PLANS
    # Permissões que a capacidade usa (rede externa, arquivos da conta, microfone…).
    permissions: tuple[str, ...] = ()
    quota: str = ""
    cost: Cost = "nenhum"
    timeout_s: int = 30
    cancellable: bool = False
    idempotent: bool = False
    # Ações que mudam ou apagam algo pedem confirmação da pessoa na tela.
    confirmation: bool = False
    provider: str = ""
    fallback: str = ""
    entrypoints: tuple[str, ...] = field(default_factory=tuple)
    modules: tuple[str, ...] = field(default_factory=tuple)
    tests: tuple[str, ...] = field(default_factory=tuple)

    def public(self) -> dict[str, Any]:
        """O que a interface pode mostrar (sem caminhos internos)."""
        return {
            "id": self.id,
            "name": self.name,
            "summary": self.summary,
            "family": self.family,
            "status": self.status,
            "plans": list(self.plans),
            "quota": self.quota,
            "cost": self.cost,
            "cancellable": self.cancellable,
        }


def _c(*args: Any, **kwargs: Any) -> Capability:
    return Capability(*args, **kwargs)


CAPABILITIES: tuple[Capability, ...] = (
    # ---------- Conversa ----------
    _c(
        "chat.conversar",
        "Conversa com o KAZ 1.1",
        "Respostas em tempo real, com Markdown, código e tabelas. Dá para parar no meio e a"
        " resposta continua no servidor se a rede cair.",
        "conversa",
        quota="unidades por janela (plano)",
        cost="modelo",
        timeout_s=240,
        cancellable=True,
        idempotent=True,
        provider="groq",
        fallback="outro modelo com cota",
        entrypoints=("POST /api/chat", "POST /api/messages/{message_id}/stop"),
        modules=("kazer/chat/service.py", "kazer/chat/generation.py"),
        tests=("tests/test_chat.py", "tests/test_groq.py"),
    ),
    _c(
        "chat.modelos_premium",
        "Modelos premium",
        "Claude, GPT e Kimi com crédito mensal medido por resposta.",
        "conversa",
        plans=PAID_PLANS,
        quota="crédito mensal em reais",
        cost="modelo_premium",
        timeout_s=240,
        cancellable=True,
        provider="anthropic/openai/moonshot",
        entrypoints=("POST /api/chat",),
        modules=("kazer/billing/catalog.py", "kazer/billing/metered.py"),
        tests=("tests/test_billing.py",),
    ),
    _c(
        "chat.anexos",
        "Ler anexos",
        "Fotos, PDF, Word, Excel, PowerPoint e arquivos de texto entram na conversa.",
        "documentos",
        permissions=("arquivos_da_conta",),
        quota="armazenamento por conta",
        cost="armazenamento",
        entrypoints=("POST /api/attachments",),
        modules=("kazer/chat/uploads.py", "kazer/chat/extract.py"),
        tests=("tests/test_chat.py", "tests/test_documents.py"),
    ),
    _c(
        "chat.pergunta_guiada",
        "Perguntas de esclarecimento",
        "Quando o pedido é ambíguo, o KAZER pergunta com opções antes de produzir.",
        "conversa",
        cost="modelo",
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/context.py",),
        tests=("tests/test_chat.py",),
    ),
    # ---------- Pesquisa ----------
    _c(
        "pesquisa.web",
        "Pesquisa na web com fontes",
        "Busca, lê as melhores páginas e responde com citações que levam à página usada.",
        "pesquisa",
        permissions=("rede_externa",),
        cost="modelo",
        timeout_s=90,
        cancellable=True,
        provider="searxng/tavily/brave/duckduckgo",
        fallback="responde sem busca e avisa",
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/prefetch.py", "kazer/chat/web_tools.py"),
        tests=("tests/test_research.py", "tests/test_web_tools.py"),
    ),
    _c(
        "pesquisa.imagens_referencia",
        "Fotos de referência com crédito",
        "Imagens de acervos livres (Wikimedia, Openverse) com autor e origem.",
        "pesquisa",
        permissions=("rede_externa",),
        provider="wikimedia/openverse",
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/web_tools.py",),
        tests=("tests/test_web_tools.py",),
    ),
    _c(
        "pesquisa.github",
        "Ler repositórios públicos do GitHub",
        "Lê arquivos e READMEs de repositórios públicos para responder.",
        "pesquisa",
        permissions=("rede_externa",),
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/web_tools.py",),
        tests=("tests/test_web_tools.py",),
    ),
    # ---------- Escrita e documentos ----------
    _c(
        "escrita.habilidades",
        "Habilidades de escrita e trabalho",
        "Mais de cem modos de trabalho (e-mail, resumo, tradução, plano, roteiro…) que ligam"
        " sozinhos pelo assunto.",
        "escrita",
        cost="modelo",
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/abilities.py",),
        tests=("tests/test_chat.py",),
    ),
    _c(
        "escrita.skills",
        "Skills (suas e da comunidade)",
        "Instruções reutilizáveis que você cria, publica ou instala, com guarda de segurança.",
        "escrita",
        confirmation=True,
        entrypoints=("GET /api/skills", "POST /api/skills"),
        modules=("kazer/chat/skill_guard.py", "kazer/chat/official_skills.py"),
        tests=("tests/test_projects_skills.py", "tests/test_skill_guard.py"),
    ),
    _c(
        "documentos.pdf",
        "PDF de verdade",
        "Documento A4 com títulos, tabelas e código, gerado no servidor a partir da resposta.",
        "documentos",
        cost="cpu",
        timeout_s=30,
        idempotent=True,
        entrypoints=("POST /api/documents/render",),
        modules=("kazer/chat/documents.py",),
        tests=("tests/test_documents.py",),
    ),
    _c(
        "documentos.artefatos",
        "Arquivos e artefatos",
        "Páginas, código, SVG e dados viram arquivo com prévia, download e .zip.",
        "documentos",
        cost="armazenamento",
        entrypoints=("GET /api/library", "GET /api/artifacts/{artifact_id}"),
        modules=("kazer/chat/artifacts.py",),
        tests=("tests/test_artifacts.py", "tests/test_library.py"),
    ),
    _c(
        "apresentacoes.slides",
        "Slides em PDF",
        "Apresentação 16:9 em PDF montada a partir do roteiro da resposta.",
        "apresentacoes",
        cost="cpu",
        timeout_s=30,
        idempotent=True,
        entrypoints=("POST /api/documents/render",),
        modules=("kazer/chat/documents.py",),
        tests=("tests/test_documents.py",),
    ),
    # ---------- Design e imagens ----------
    _c(
        "imagens.criar",
        "Criar imagem",
        "Gera uma imagem a partir de um texto, com formato e estilo. Uma imagem concluída por"
        " dia (UTC) em cada conta; falha não gasta o dia.",
        "imagens",
        status="needs_config",
        quota="1 imagem concluída por dia (UTC)",
        cost="gpu",
        timeout_s=90,
        idempotent=True,
        provider="servidor de inferência próprio",
        fallback="indisponível, com explicação na tela",
        entrypoints=(
            "GET /api/images",
            "POST /api/images",
            "GET /api/images/{image_id}/file",
            "DELETE /api/images/{image_id}",
        ),
        modules=("kazer/images/service.py", "kazer/images/providers.py"),
        tests=("tests/test_create.py",),
    ),
    # ---------- Dados e código ----------
    _c(
        "dados.diagramas",
        "Diagramas e tabelas",
        "Fluxogramas, mapas e tabelas montados na resposta, prontos para baixar.",
        "dados",
        cost="modelo",
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/artifacts.py",),
        tests=("tests/test_artifacts.py",),
    ),
    _c(
        "codigo.kz_code",
        "KZ Code",
        "Oficina de código: arquivos inteiros, prévia e sessões guardadas.",
        "codigo",
        plans=PAID_PLANS,
        cost="modelo",
        timeout_s=240,
        cancellable=True,
        entrypoints=("POST /api/chat",),
        modules=("kazer/chat/service.py",),
        tests=("tests/test_forja.py",),
    ),
    _c(
        "codigo.terminal",
        "KAZER no terminal",
        "A mesma conta e as mesmas conversas, direto do terminal.",
        "codigo",
        entrypoints=("POST /api/chat",),
        modules=("kazer/interfaces/terminal/shell.py",),
        tests=("tests/test_terminal.py",),
    ),
    _c(
        "codigo.github_conector",
        "Conector do GitHub",
        "Ler e (nos planos pagos) escrever em repositórios pelo servidor MCP oficial.",
        "codigo",
        status="paused",
        permissions=("rede_externa", "conta_github"),
        confirmation=True,
        modules=("kazer/chat/connectors.py", "kazer/chat/mcp.py"),
        tests=("tests/test_connectors.py",),
    ),
    # ---------- Voz ----------
    _c(
        "voz.conversa",
        "Conversa por voz",
        "Você fala, o KAZER responde em voz alta e para quando você interrompe. O áudio do"
        " microfone não é gravado nem guardado.",
        "voz",
        permissions=("microfone",),
        quota="trechos falados por hora",
        cost="cpu",
        timeout_s=30,
        cancellable=True,
        provider="piper (código aberto)",
        fallback="legenda na tela, sem voz",
        entrypoints=("GET /api/voice/config", "POST /api/voice/tts"),
        modules=("kazer/voice/tts.py", "kazer/interfaces/web/voice_api.py"),
        tests=("tests/test_voice.py",),
    ),
    _c(
        "voz.ditado",
        "Ditado",
        "Fale e o texto aparece no campo, pelo reconhecimento do próprio navegador.",
        "voz",
        permissions=("microfone",),
        provider="navegador",
        fallback="botão avisa quando o navegador não tem o recurso",
        modules=("kazer/interfaces/web/static/assets/voice.js",),
    ),
    # ---------- Memória e conta ----------
    _c(
        "memoria.longo_prazo",
        "Memória da conta",
        "O KAZER pode guardar preferências e contexto que você conta sobre si, para as próximas"
        " conversas. Você vê, edita, apaga e desliga quando quiser.",
        "memoria",
        quota="100 memórias por conta",
        idempotent=True,
        confirmation=True,
        entrypoints=(
            "POST /api/memories",
            "PATCH /api/memories/{memory_id}",
            "DELETE /api/memories/{memory_id}",
            "POST /api/memories/clear",
        ),
        modules=("kazer/chat/memory.py",),
        tests=("tests/test_memory_auto.py",),
    ),
    _c(
        "conta.privacidade",
        "Exportar e excluir dados",
        "Baixar tudo em JSON, apagar conversas e excluir a conta.",
        "conta",
        confirmation=True,
        entrypoints=("GET /api/account/export", "POST /api/account/delete"),
        modules=("kazer/chat/service.py",),
        tests=("tests/test_chat.py",),
    ),
    _c(
        "conta.planos",
        "Planos e uso",
        "Ver o plano, quanto resta da janela e assinar pelo Stripe.",
        "conta",
        provider="stripe",
        entrypoints=("GET /api/plans",),
        modules=("kazer/chat/plans.py", "kazer/billing/stripe_webhook.py"),
        tests=("tests/test_plans.py", "tests/test_billing.py"),
    ),
)

_BY_ID = {capability.id: capability for capability in CAPABILITIES}


def by_id(capability_id: str) -> Capability | None:
    return _BY_ID.get(capability_id)


def public_catalog(plan: str, overrides: dict[str, Status] | None = None) -> list[dict[str, Any]]:
    """Catálogo para a tela: marca o que o plano da conta alcança.

    `overrides` troca o estado de capacidades que dependem do ambiente
    (por exemplo, `imagens.criar` vira `available` quando há provedor).
    """
    items = []
    for capability in CAPABILITIES:
        item = capability.public()
        if overrides and capability.id in overrides:
            item["status"] = overrides[capability.id]
        item["included"] = plan in capability.plans
        items.append(item)
    return items
