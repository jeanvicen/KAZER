# Pesquisa competitiva de IA para desenvolvedores

**Data de acesso:** 17/09/2026. A pesquisa comparou ChatGPT, Claude, Gemini, Kimi, DeepSeek e Grok com foco em coding agents, Skills, agentes, conectores/MCP, memória/contexto, UX e monetização. A comparação com KAZER é estratégica e qualitativa; não há benchmark público comum nem documentação pública inequívoca do KAZER para comparação factual.

## Padrões de mercado

Os seis ecossistemas convergem em delegação ponta a ponta: o usuário descreve uma intenção, o agente inspeciona um repositório, edita vários arquivos, executa comandos/testes, apresenta diff e devolve evidências. O segundo padrão é extensibilidade por Skills, plugins, MCP, SDKs, function calling e arquivos de instrução. O terceiro é contexto persistente por projeto, memória ou notas. O quarto é distribuição multiplataforma: IDE, terminal, desktop, web, mobile e API. O quinto é monetização freemium combinada com limites, créditos, assinatura por usuário e API por uso.

A lacuna explorável por KAZER é não tentar vencer em amplitude. O produto pode ser menor, mais coerente e verificável: uma tarefa de engenharia como unidade central, com plano, permissões, diff, testes, custo, rollback e memória versionada de repositório. Memória e Skills devem ser tratadas como contexto interpretável, nunca como mecanismo de segurança. MCP e conectores devem seguir menor privilégio, aprovação por ação e logs sem segredos.

## Comparação resumida

| Produto | Gancho para desenvolvedores | Contexto/extensibilidade | Monetização e ressalvas |
|---|---|---|---|
| ChatGPT | Codex para coding agent, Work para tarefas longas, Projects, Apps/MCP e Skills | Apps, MCP, Skills, Projects, memória, web/mobile/desktop | Free, Go, Plus, Pro, Business e Enterprise; API separada; limites e créditos podem ser compartilhados entre recursos agentic |
| Claude | Claude Code com edição, testes, Git/PRs, subagentes, Remote Control e Agent SDK | Skills, MCP, CLAUDE.md, auto memory, Projects, conectores | Pro/Max compartilham limites com Claude Code; API/créditos separados; memória local não é uma política de segurança |
| Gemini | Code Assist/CLI com plano, diff, shell, MCP, GitHub Actions; agentes em sandbox | Function calling, Search/Maps/Code Execution/URL Context/File Search, Gems, memória, MCP | Apps, API, AI Studio e Code Assist são superfícies distintas; região, conta e plano mudam disponibilidade |
| Kimi | Kimi Code em Desktop/CLI/VS Code, Skills, MCP, compatibilidade OpenAI/Anthropic, long context | Skills por Markdown, MCP por projeto, Work, Browser Extension, API | Assinaturas em RMB, créditos e limite próprio de Kimi Code; API separada; nomenclatura/modelos mudam rapidamente |
| DeepSeek | API compatível com clientes existentes, tool calls, 1M context, cache e Harness preview | Responses stateless, function calling, Codex/Claude Code/OpenCode; MCP marcado como ignorado no endpoint | Chat anunciado como gratuito; API pré-paga, horários peak/off-peak; Harness ainda é developer preview |
| Grok | Grok Build TUI/headless/ACP, worktrees, Skills/plugins, subagentes e Bot com computador | MCP remoto, conectores OAuth, structured outputs, memória de projeto | Free, SuperGrok, SuperGrok Plus, Enterprise e API; Build, Bot, app e API têm direitos diferentes |

## Fontes principais

- ChatGPT: https://openai.com/codex/ ; https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex ; https://help.openai.com/en/articles/11487775-connectors-in-chatgpt ; https://help.openai.com/en/articles/20001066-skills-in-chatgpt ; https://help.openai.com/en/articles/8590148-memory-faq ; https://chatgpt.com/pricing/
- Claude: https://docs.anthropic.com/en/docs/claude-code ; https://docs.anthropic.com/en/docs/claude-code/skills ; https://docs.anthropic.com/en/docs/claude-code/mcp ; https://docs.anthropic.com/en/docs/claude-code/memory ; https://docs.anthropic.com/en/docs/claude-code/remote-control ; https://claude.com/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/agents ; https://ai.google.dev/gemini-api/docs/tools ; https://ai.google.dev/gemini-api/docs/coding-agents ; https://ai.google.dev/gemini-api/docs/function-calling ; https://ai.google.dev/gemini-api/docs/pricing
- Kimi: https://www.kimi.com/code/docs/en/ ; https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html ; https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html ; https://www.kimi.com/en/help/membership/membership-pricing ; https://github.com/MoonshotAI/kimi-cli
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/ ; https://api-docs.deepseek.com/guides/tool_calls/ ; https://api-docs.deepseek.com/guides/responses_api/ ; https://www.deepseek.com/harness/en/ ; https://api-docs.deepseek.com/guides/kv_cache/
- Grok: https://docs.x.ai/build/overview ; https://docs.x.ai/build/features/skills-plugins-marketplaces ; https://docs.x.ai/developers/tools/remote-mcp ; https://docs.x.ai/grok/connectors ; https://x.ai/pricing
- Contexto de mercado: https://www.reuters.com/technology/anthropic-valued-380-billion-latest-funding-round-2026-02-12/ ; https://www.theverge.com/report/874308/anthropic-claude-code-opus-hype-moment ; https://www.reuters.com/business/media-telecom/spacexai-launches-grok-45-model-coding-agentic-tasks-2026-07-08/ ; https://techcrunch.com/2026/08/24/openai-is-building-an-ai-agent-for-everything-will-everyone-use-them/

## Recomendações estratégicas resultantes

1. Tornar a entrega verificável o produto principal: intenção → plano → patch → execução controlada → testes → diff → aprovação → rollback/PR.
2. Aplicar menor privilégio por ferramenta, arquivo, comando e rede, com aprovação por risco e kill switch.
3. Exibir estimativa e extrato de custo por tarefa/projeto, com orçamento e teto rígido.
4. Criar memória de repositório versionada, citável, com origem, escopo, data, autor e exclusão explícita.
5. Suportar portabilidade de Skills, instruções e MCP sem lock-in de modelo.
6. Unificar IDE/CLI com acompanhamento remoto, mantendo autoridade local sobre filesystem e credenciais.
7. Começar por manutenção e entrega contínua: issues, dependências, regressões, PRs e triagem de CI.
8. Medir confiabilidade com harness próprio e publicar métricas de sucesso, falha, custo, tempo e intervenção humana.

## Ressalvas

Disponibilidade, preços e limites variam por plano, país, conta, modelo, sistema operacional e rollout. Documentação de recursos não é benchmark. Contexto persistente não é memória semântica perfeita. Memória e Skills não são controles de segurança. MCPs remotos e conectores podem ampliar risco de prompt injection, exfiltração e ações indevidas. DeepSeek informa processamento/armazenamento na China; a política da X descreve uso potencial de dados do Grok para treinamento e personalização com controles de opt-out. Métricas de receita e adoção devem ser atribuídas às fontes e não tratadas como prova de qualidade técnica.
