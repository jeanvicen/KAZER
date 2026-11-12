# kazer/chat — o coração do KAZER (conversa)

**O que é:** tudo que acontece quando alguém manda uma mensagem: validar, checar
cota e posse, pesquisar na web se precisar, montar o contexto, chamar o modelo em
streaming, salvar a resposta, artefatos, PDFs e Skills.

| Arquivo | Papel |
|---|---|
| `service.py` | **Regras do chat** (`ChatService`): envio, cota, anexos, memória, preferências, artefatos |
| `generation.py` | Gerações em andamento, desacopladas da conexão (a rede cai e a resposta continua) |
| `context.py` | O que o modelo recebe: instruções do KAZER, preferências, histórico, regras do modo voz |
| `prefetch.py` | Pesquisa **antes** do modelo (decide se precisa buscar, lê páginas, cita fontes) |
| `web_tools.py` | Busca na web, leitura de páginas e GitHub (com proteção contra endereço interno) |
| `artifacts.py` | Detecta entregáveis (página, código, SVG…) **só quando a pessoa pediu** |
| `documents.py` | PDFs de verdade (A4 e slides 16:9) a partir do Markdown |
| `extract.py` | Texto de anexos: PDF, Word, Excel, PowerPoint |
| `uploads.py` | Validação e guarda privada de anexos |
| `abilities.py` | 100+ habilidades embutidas que ligam sozinhas pelo assunto |
| `official_skills.py`, `external_skills.py` | Skills oficiais (fixas) e catálogo público |
| `skill_guard.py` | Barra Skill perigosa (texto invisível, "ignore as regras", vazamento) |
| `plans.py` | Catálogo de planos e limites |
| `connectors.py`, `mcp.py` | Conector GitHub via MCP (pausado no momento) |
| `protocols.py` | Contrato do armazenamento |
| `store.py` | Armazenamento SQLite (desenvolvimento) |
| `supabase_store.py` | Armazenamento no Postgres do Supabase (produção, com RLS) |
| `memory.py` | Memória de longo prazo: o que entra sozinho, filtro de dado sensível, duplicatas e escolha por relevância (regras, sem modelo) |
| `store_extras.py`, `supabase_extras.py` | Imagens geradas, projetos do Studio e campos de procedência da memória (SQLite e Supabase) |
| `identity.py` | Token da sessão atual para o Supabase falar "como a pessoa" |
| `.service_skills.patch` | Patch antigo da integração de Skills, já aplicado (histórico; não é carregado) |

**Fluxo de uma mensagem:** `POST /api/chat` (`interfaces/web/chat_api.py`) →
`ChatService.send` → `prefetch` (se precisar) → `context.system_prompt` →
`brain/model_provider` (stream) → salva → eventos NDJSON para a tela.

**Cuidados**
- Conteúdo de site, anexo ou Skill da comunidade é **dado**, nunca instrução.
- Tudo é por conta: uma pessoa nunca lê conversa de outra (testado em `tests/test_chat*.py`).

---
Mapa geral do repositório: [README principal](../../README.md).
