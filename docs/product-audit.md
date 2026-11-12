# Auditoria do produto

Estado em **2026-11-12**, branch `claude/kazer-multiple-improvements-hze6sl`.
Tudo aqui foi conferido no código, nos testes ou rodando o app; onde não deu para
conferir, está escrito.

## 1. O que é o KAZER (de fato)

| Camada | O que existe |
|---|---|
| Servidor | Uma aplicação Starlette (Python 3.11+), `kazer.interfaces.web.asgi:app`, na Vercel |
| Front | HTML + CSS + módulos JavaScript **sem build**, em `kazer/interfaces/web/static/` |
| Contas | Supabase Auth em produção; SQLite local no desenvolvimento. E-mail e senha, sem login social |
| Dados | Postgres do Supabase com RLS, acessado por funções `kazer_*` com o JWT da pessoa |
| Modelo | "KAZ 1.1" = Groq (com governador de cota); Claude/GPT/Kimi nos planos pagos |
| Voz | Piper (código aberto) no servidor; reconhecimento de fala do navegador |
| Cobrança | Stripe (checkout + webhook assinado), créditos medidos por resposta |
| Operação | `controle-de-notificacao/controle.yaml` (manutenção e aviso global) |

Repositório conferido: `origin = https://github.com/jeanvicen/KAZER` (o prompt cita
`jeanvicen/Kazer`; é o mesmo repositório, o GitHub não diferencia maiúsculas).

## 2. Linha de base (antes de mexer)

| Verificação | Comando | Resultado |
|---|---|---|
| Lint | `ruff check .` | passou |
| Testes | `pytest -q` | 321 passaram, 1 pulado (precisa do modelo de voz no disco) |
| Painel do dono | `python scripts/controle.py` | passou |
| Sintaxe do front | `node --check` em todos os `.js` | passou |
| Tipos | `mypy kazer` | **91 erros em 36 arquivos** (dívida antiga; o CI não roda mypy) |
| Migrações SQL do zero | — | **não havia como rodar**: nenhum script subia um Postgres local |

## 3. Inventário de capacidades reais

O inventário vivo é o registro `kazer/capabilities/registry.py` (23 capacidades,
cada uma com rotas, módulos e testes conferidos por `tests/test_capabilities.py`).
Resumo: conversa em streaming, modelos premium, anexos, pesquisa com fontes, fotos de
referência, leitura de GitHub público, habilidades e Skills, PDF e slides, artefatos e
biblioteca, KZ Code, terminal, voz, ditado, memória, exportar/excluir conta, planos.
Novas nesta rodada: **Studio**, **criar imagem** (depende de configuração) e
**memória automática**.

## 4. Problemas encontrados

| # | Problema | Gravidade | Situação |
|---|---|---|---|
| 1 | **Migrações não são reproduzíveis do zero**: a primeira assume uma tabela `public.profiles` criada à mão no projeto Supabase | Média (risco em recuperação de desastre) | **Mitigado**: `scripts/pg_test.sh` documenta e recria a base mínima; falta uma migração "zero" oficial (backlog P1) |
| 2 | Testes SQL (`supabase/tests/`) só rodavam à mão contra um banco real | Média | **Corrigido**: `scripts/pg_test.sh` sobe um Postgres descartável, aplica as 11 migrações e roda os 6 testes |
| 3 | Memória só manual; todas as memórias iam em toda pergunta | Baixa | **Corrigido**: extração automática com filtro de dado sensível, edição, procedência e escolha por relevância |
| 4 | Nenhum lugar listava o que o produto faz de verdade | Média (botão morto nasce assim) | **Corrigido**: registro tipado + teste que quebra se apontar para rota inexistente |
| 5 | Sem criação de imagem nem cota por conta | — (funcionalidade) | **Feito** no servidor e na tela; a geração em si precisa de GPU (ver `docs/images/RUNTIME.md`) |
| 6 | Sem editor de design | — (funcionalidade) | **Feito**: Studio MVP (criar, editar, salvar, reabrir, exportar) |
| 7 | `ChatStore` (SQLite) abre `BEGIN IMMEDIATE` até para leitura: uma escrita por vez **e uma leitura por vez** | Baixa (só desenvolvimento; produção usa Postgres) | Documentado; medido em `docs/architecture/target-architecture.md` |
| 8 | Limitador de taxa e caches vivem na memória de cada instância | Média em escala | Documentado; os limites que importam (cota de chat, imagem, projetos) já são do banco |
| 9 | `mypy` com 91 erros | Baixa | Não corrigido nesta rodada (backlog P2) |
| 10 | Conector do GitHub pausado, mas o código continua no repositório | Baixa | Registrado como `paused` no registro; a interface não o oferece |
| 11 | `kazer/core`, `memory`, `runtime`, `tools`, `observability` são esqueletos sem uso no produto | Baixa (confunde quem chega) | Documentado nos READMEs de cada pasta |
| 12 | Voz Piper `pt_BR-cadu`: licença do conjunto de dados não conferida | Média para uso comercial | **Pendente** (Hugging Face bloqueado na rede desta sessão) |
| 13 | HawkScan (varredura dinâmica) configurado como rotina, sem chave | — | **NÃO RODOU**: `HAWK_API_KEY` ausente |

Não foram encontrados nesta auditoria: segredo no front, botão sem ação, dado de
uma conta visível a outra, ou rota de escrita sem verificação de origem. Isso vale
para o que foi lido e testado (rotas de conta, chat, voz, criação e painel), não é
uma auditoria externa.

## 5. O que mudou nesta rodada

| Área | Antes | Depois |
|---|---|---|
| Testes automáticos | 321 | 370 (+49: criação, memória, registro) |
| Testes SQL em Postgres real | rodados à mão | `bash scripts/pg_test.sh` (11 migrações, 6 arquivos, corrida com 12 sessões) |
| Capacidades documentadas e conferidas | nenhuma | 23 no registro |
| Skills do projeto | nenhuma | 9 em `.claude/skills/` |
| Telas | — | Studio, Criar imagem; Memória ganhou salvamento automático e edição |
| Dependências novas | — | Fabric.js 7.4.0 (MIT), só no navegador |
| Serviços pagos novos | — | nenhum |

## 6. Fluxos críticos que continuam funcionando

Cadastro, entrada, sessão, sair, recuperação de senha, exclusão de conta, chat,
anexos, pesquisa, planos, voz e painel de manutenção: cobertos pela suíte que já
existia (`test_web_auth.py`, `test_auth.py`, `test_chat.py`, `test_voice.py`,
`test_control.py`…), toda verde depois das mudanças. O fluxo de e-mail de verdade
(SMTP/Supabase) **não é exercitado** pelos testes: eles usam dublês.
