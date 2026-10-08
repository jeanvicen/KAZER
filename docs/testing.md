# Testes e verificações

## Execução local

Requer Node.js 20 ou superior e npm. Na raiz do repositório:

```bash
npm ci --ignore-scripts
npm test
npm run check
npm run integration:test
npm run security:audit -- --audit-level=high
```

- `npm test`: suíte Node.js (`node --test`) com regressões e compatibilidade de esquema, incluindo `test/ssrf-egress.test.mjs` para filtros de endereços, fixação de DNS, limites de corpo e redirects simulados; `test/mcp-schema.test.mjs` para o subconjunto JSON Schema aceito; e `test/mcp-approvals.test.mjs` para cifra, vínculo ao usuário e a lógica condicional de uso único, com PostgREST simulado.
- `npm run check`: verificações estáticas de segurança e regressões de chat, pesquisa, Brain e configuração relacionada.
- `npm run integration:test`: smoke tests para MCP, APIs/handlers, OAuth do GitHub e configuração de produção. Os testes usam stubs e segredos exclusivos de teste; não chamam contas reais nem validam implantação ou banco em produção.
- Job `mcp-approval-migration` do CI: aplica a migration `022_mcp_action_approvals.sql` em um PostgreSQL descartável e verifica RLS/grants e a transição condicional de estado do ticket; não testa o histórico de bootstrap completo nem a configuração de produção.

Chamadas `tools/call` do MCP ficam suspensas até a pessoa revisar conector, ferramenta e argumentos e escolher permitir uma vez. A recusa consome o ticket sem chamar a ferramenta. A aprovação fica vinculada à conta, à conversa e à impressão digital atual do conector/schema; a atualização condicional de status permite somente um consumo. A migração continua pendente de aplicação em um ambiente real, fora deste trabalho.
- `npm run security:audit -- --audit-level=high`: auditoria npm das dependências de produção conforme o script `security:audit`.

## Integrações e limites

O workflow em `.github/workflows/ci.yml` executa `npm test`, `npm run check`, `npm run integration:test` e a auditoria npm em pushes para `main` e pull requests. O resultado é específico ao commit e deve ser conferido no [histórico do workflow](https://github.com/jeanvicen/KAZER/actions/workflows/ci.yml); um workflow existente não significa que toda execução recente passou.

Os testes de saída simulam o resolver DNS e o transporte HTTP: cobrem o caminho fixado de MCP, redirects do fallback HTTP de pesquisa e limites de bytes, mas não fazem probes de rede. Eles não eliminam nem testam a corrida DNS do Chromium/Playwright, porque o browser valida o destino e deixa o próprio Chromium resolver/conectar. A validação MCP aceita um subconjunto delimitado de JSON Schema; esquemas com keywords não suportadas são rejeitados e a ferramenta correspondente não é exposta ao modelo. Esta alteração não resolve a corrida DNS do Chromium, o uso de `unsafe-inline` na CSP ou os rate limits em memória por processo; esses itens requerem uma etapa arquitetural própria. Os testes não validam MCPs remotos reais, não comprovam isolamento real entre duas contas Supabase, estado/schema de produção, sucesso de deploy Vercel, OAuth em WebView/mobile, pentest, teste visual móvel ou configuração externa; esses itens exigem validação operacional separada.

Os testes estáticos e de smoke cobrem contratos de código, não qualidade subjetiva dos modelos ou garantias de segurança. Erros e regressões devem ser diagnosticados pelo log da execução correspondente, sem remover ou enfraquecer testes para obter um status verde.
