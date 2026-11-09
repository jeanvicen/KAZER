# kazer — o código do KAZER (pacote Python)

**O que é:** todo o servidor: site, API, chat, contas, cobrança, voz e os
contratos do agente. Uma única aplicação Starlette (`kazer.interfaces.web.asgi:app`)
roda na Vercel.

| Pasta | Responsabilidade | Estado |
|---|---|---|
| `interfaces/web/` | Site + API `/api/*` + front-end estático | **em produção** |
| `interfaces/terminal/` | KAZER no terminal (mesma conta e API) | em produção |
| `chat/` | Conversa, pesquisa, anexos, artefatos, PDFs, Skills | **em produção** |
| `auth/` | Contas: Supabase Auth ou local (SQLite) | em produção |
| `billing/` | Planos, créditos premium, Stripe | em produção |
| `brain/` | Provedores de modelo (Groq = "KAZ 1.1", etc.) | em produção |
| `voice/` | Modo voz: voz Piper no servidor, tokens, gateway opcional | em produção |
| `config/` | Configuração validada + **painel de manutenção/aviso** (`control.py`) | em produção |
| `security/` | Senhas, segredos por escopo, limites de taxa, guardas | em produção |
| `integrations/` | E-mail e pagamentos (outros são esqueleto) | parcial |
| `assets/` | Fontes usadas para gerar PDFs | em produção |
| `core/`, `memory/`, `runtime/`, `tools/`, `observability/` | Contratos do agente autônomo | **esqueleto** (base para evoluir) |

| Arquivo | Papel |
|---|---|
| `__init__.py` | Marca o pacote |
| `main.py` | Ponto de composição mínimo (não sobe o site; o site é `python -m kazer.interfaces.web`) |

**Regras que valem em todo o pacote**
- Segredo só por `kazer.security.secrets` (nunca `os.environ` espalhado).
- Erro para o navegador é sempre um código estável (`{"error": "..."}`), nunca a exceção.
- Autorização é do servidor; o front só mostra.

---
Mapa geral do repositório: [README principal](../README.md).
