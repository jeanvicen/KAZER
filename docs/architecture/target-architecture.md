# Arquitetura: hoje e para onde vai

## 1. Hoje (o que está rodando)

```
 Navegador (PWA, sem build)                Vercel (funções Python, sem disco)
 ┌───────────────────────────┐   HTTPS    ┌──────────────────────────────────────┐
 │ index.html + módulos ES   │ ─────────▶ │ Starlette  kazer.interfaces.web      │
 │ chat.js · studio.js ·     │  cookie    │  app.py      páginas, contas, status │
 │ criar.js · voicemode.js   │  HttpOnly  │  chat_api    conversa, anexos, conta │
 │ sw.js (só a casca offline)│ ◀───────── │  create_api  imagens, Studio, catálogo│
 └───────────────────────────┘  NDJSON    │  voice_api   voz                     │
                                          └───────┬───────────────┬──────────────┘
                                                  │ JWT da pessoa │ chaves do servidor
                                   ┌──────────────▼───┐   ┌───────▼──────────────────┐
                                   │ Supabase         │   │ Provedores               │
                                   │  Auth            │   │  Groq (KAZ 1.1)          │
                                   │  Postgres + RLS  │   │  Anthropic/OpenAI (pagos)│
                                   │  Storage privado │   │  Buscadores, Stripe      │
                                   └──────────────────┘   │  Servidor de imagem (seu)│
                                                          └──────────────────────────┘
```

Decisões que continuam valendo:

- **Monólito modular.** Um processo, pacotes por responsabilidade (`chat`, `auth`,
  `billing`, `voice`, `images`, `studio`, `capabilities`). Nada de microserviço: o
  gargalo é o modelo de IA, não o servidor web.
- **Sem estado no servidor web.** Sessão no cookie, dados no Postgres, arquivos no
  Storage. Qualquer instância atende qualquer pedido.
- **O banco decide o que importa.** Posse (RLS + `auth.uid()` em toda função), cota de
  conversa, cota de imagem, limite de projetos e de memórias são do Postgres.
- **O front não decide nada.** Plano, cota e disponibilidade vêm da API.

## 2. Capacidades como contrato

`kazer/capabilities/registry.py` descreve cada capacidade: id, família, estado,
planos, permissões, cota, classe de custo, prazo, se cancela, se é idempotente, se
pede confirmação, provedor e reserva, rotas, módulos e testes. `GET /api/capabilities`
entrega a parte pública já marcada com o plano da conta e com o que o ambiente
alcança (ex.: `imagens.criar` vira `available` só com provedor ligado).

Para acrescentar uma capacidade: construir de ponta a ponta → registrar → o teste
`tests/test_capabilities.py` confere rotas e arquivos. Passo a passo em
`.claude/skills/kazer-agent-engineering/SKILL.md`.

## 3. Trabalho longo

| Trabalho | Hoje | Limite conhecido | Próximo passo (quando medido) |
|---|---|---|---|
| Resposta do chat | *thread* própria; a resposta continua se a conexão cair e a tela reata | tempo máximo da função na Vercel | manter |
| Imagem | dentro da requisição, com prazo (`KAZER_IMAGE_TIMEOUT`, 90 s por padrão) e ciclo **reservar → gerar → concluir**; reserva abandonada expira em 10 min | o provedor precisa responder dentro do prazo da função | fila durável no Postgres (pgmq / Supabase Queues) com *worker* ao lado da GPU |
| PDF e slides | na requisição (CPU, < 1 s nos testes) | documentos enormes | fila, se aparecer demanda |
| Exportar do Studio | **no navegador** (custo zero no servidor) | memória do aparelho | manter |

Por que ainda não há fila: nenhum trabalho atual passa do prazo de uma requisição, e
fila sem *worker* dedicado não resolve nada. O desenho já é o de um *job* (linha
`kazer_image_jobs` com estado, chave de idempotência e expiração), então trocar o
"gera na requisição" por "enfileira e o worker conclui" não muda tela nem cota.

## 4. Medições (o que foi medido de verdade)

**Ambiente:** esta sessão, 4 vCPU, 16 GB, Linux, Python 3.13; **um** processo uvicorn;
banco **SQLite** local; gerador de carga (`scripts/load_test.py`, 40 conexões, 5 contas
sintéticas, 8 s por cenário) **na mesma máquina**, disputando CPU com o servidor.
Sem modelo de IA no caminho. Data: 2026-11-12.

| Cenário | req/s | p50 | p95 | p99 | Sucesso |
|---|---|---|---|---|---|
| `GET /api/health` (sem banco) | 902 | 34 ms | 102 ms | 145 ms | 100 % |
| `GET /api/status` (painel, arquivo em cache) | 932 | 34 ms | 98 ms | 136 ms | 100 % |
| `GET /api/conversations` (sessão + banco) | 442 | 23 ms | 436 ms | 1004 ms | 100 % |
| `GET /api/images` (sessão + cota + galeria) | 260 | 64 ms | 629 ms | 1147 ms | 100 % |
| `PUT /api/designs/{id}` (escrita de ~20 kB) | 371 | 19 ms | 536 ms | 1139 ms | 39 % → o resto foi **429 do limitador** (240 gravações/hora por conta), como projetado |

Postgres local, 12 sessões simultâneas pedindo imagem com limite 1
(`scripts/pg_concurrency.py`): **1 reserva, 11 barradas**; 12 sessões com a mesma
chave: **1 pedido, 11 repetições**.

**O que estes números dizem e o que não dizem**

- Dizem que o código do servidor web não é o gargalo: centenas de pedidos por segundo
  num processo só, com o gerador de carga roubando CPU.
- A cauda longa (p95/p99) nos cenários com banco vem do **SQLite local**, que serializa
  toda transação (`BEGIN IMMEDIATE`, inclusive leitura). Produção usa Postgres; este
  número **não** foi medido lá.
- **Não dizem nada sobre produção.** Não houve teste de carga contra a Vercel nem contra
  o Supabase de produção (não é para fazer sem autorização, e custa cota).

## 5. Onde estão os gargalos reais

| Recurso | Por que limita | Sinal de que chegou | O que fazer |
|---|---|---|---|
| **Cota do modelo (Groq)** | limite por minuto e por dia compartilhado por todas as contas | `groq_limits` troca de modelo / respostas 429 | plano pago do provedor, mais provedores, fila de espera visível |
| **GPU de imagem** | uma imagem ocupa a GPU por segundos | `image_busy`, fila crescendo | 1 imagem/dia já limita; depois, fila + mais GPU |
| Conexões do Postgres | cada função abre conexões HTTP para o PostgREST (pool do Supabase) | erros 5xx do `rest/v1` | manter chamadas por RPC (uma por operação), *pooler* do Supabase |
| Tempo de função | resposta longa de modelo | cortes no meio | o chat já sobrevive a queda de conexão; reduzir prazo de imagem |
| Armazenamento e tráfego | anexos, imagens geradas, projetos | painel do Supabase | limites por plano já existem (anexos, 30 projetos de até 3 MB, 1 imagem/dia) |
| Limitador em memória | cada instância conta separado | abuso distribuído passa | mover os limites sensíveis para o Postgres (os de dinheiro já estão) |

## 6. Crescimento: o que muda em cada degrau

Estes cenários são **estimativas de arquitetura**, não medições. "Simultâneos" aqui é
gente com uma resposta sendo gerada ao mesmo tempo; adote 1–3 % dos usuários ativos do
dia como hipótese até medir.

| Contas | Hipótese de simultâneos | O que aguenta | O que quebra primeiro | Custo que aparece |
|---|---|---|---|---|
| 1 mil | ~5–20 | arquitetura atual | cota gratuita do modelo em horário de pico | nenhum obrigatório além do que já existe |
| 10 mil | ~50–200 | servidor web e Postgres atuais | **cota do modelo** (com folga) e limites do plano gratuito do banco/armazenamento | plano pago do provedor de modelo; plano pago do Supabase |
| 100 mil | ~500–2 mil | monólito em várias instâncias | conexões do banco, tráfego de saída, limitador em memória | banco maior + *pooler*, fila para trabalho longo, observabilidade de verdade |
| 1 milhão | ~5–20 mil | **não demonstrado** | tudo o que está acima, mais custo de inferência | infraestrutura dedicada de inferência, réplicas de leitura, equipe de operação |

**Não há evidência de que o KAZER atenda 1 milhão de usuários simultâneos**, nem
pretensão disso. O que existe é um desenho sem estado, com as cotas no banco, que não
precisa ser reescrito para crescer.

Limites e preços dos planos gratuitos mudam; confira nas páginas oficiais antes de
planejar: <https://supabase.com/docs/guides/platform/billing-on-supabase> e a página
de limites do seu provedor de modelo.

## 7. SLOs candidatos (para medir em produção)

| Indicador | Meta inicial sugerida | Como medir |
|---|---|---|
| Disponibilidade de `/api/health` | 99,5 % ao mês | monitor externo |
| Tempo até o primeiro texto do chat | p95 < 3 s (sem pesquisa) | evento `delta` − envio, no servidor |
| Erro 5xx nas rotas de API | < 0,5 % | logs da Vercel |
| Imagem concluída entre as iniciadas | > 95 % | `kazer_image_jobs` por estado |
| Salvamento do Studio | p95 < 1 s | log do servidor |

Nenhum destes tem valor atual: **ainda não são medidos em produção**.

## 8. Observabilidade

Hoje: `logging` padrão com nomes estáveis (`kazer.web`, `kazer.chat`, `kazer.control`),
sem conteúdo de conversa nem segredo, lidos nos logs da Vercel; estado dos pedidos de
imagem na própria tabela. Próximo passo avaliado: OpenTelemetry (Apache-2.0) com
identificador de pedido propagado e métricas por capacidade (latência, erro, negação de
cota), sem texto da pessoa.

## 9. Dados: retenção, cópia e reversão

- Migrações só aditivas, em `supabase/migrations/`, com a reversão escrita no fim do
  arquivo novo. Ordem e testes: `bash scripts/pg_test.sh`.
- Excluir a conta apaga em cascata (`on delete cascade` em toda tabela de dono).
- Cópia de segurança e restauração são as do Supabase; **não há rotina própria
  testada** de restauração (backlog P1).
