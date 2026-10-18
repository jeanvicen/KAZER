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

- `npm test`: suíte Node.js (`node --test`) com regressões e compatibilidade de esquema, incluindo `test/ssrf-egress.test.mjs` para filtros de endereços, fixação de DNS, limites de corpo e redirects com resolvers/transports simulados (sem sondas de rede reais).
- `npm run check`: verificações estáticas de segurança e regressões de chat, pesquisa, Brain e configuração relacionada.
- `npm run integration:test`: smoke tests para MCP, APIs/handlers, OAuth do GitHub e configuração de produção. Os testes usam stubs e segredos exclusivos de teste; não chamam contas reais nem validam implantação ou banco em produção.
- `npm run security:audit -- --audit-level=high`: auditoria npm das dependências de produção conforme o script `security:audit`.

## Integrações e limites

O workflow em `.github/workflows/ci.yml` executa `npm test`, `npm run check`, `npm run integration:test` e a auditoria npm em pushes para `main` e pull requests. O resultado é específico ao commit e deve ser conferido no [histórico do workflow](https://github.com/jeanvicenc4/KAZER/actions/workflows/ci.yml); um workflow existente não significa que toda execução recente passou.

Os testes de saída simulam o resolver DNS e o transporte HTTP: cobrem o caminho fixado de MCP, redirects do fallback HTTP de pesquisa e limites de bytes, mas não fazem probes de rede. Eles não eliminam nem testam a corrida DNS do Chromium/Playwright, porque o browser valida o destino e deixa o próprio Chromium resolver/conectar. Também não validam MCPs remotos reais nem acrescentam confirmação por ação ou validação completa de esquemas para chamadas de ferramentas do modelo. Os testes automatizados tampouco comprovam isolamento real entre duas contas Supabase, conteúdo/schema de produção, sucesso de deploy Vercel, OAuth em WebView/mobile, pentest, teste visual móvel ou configuração externa; esses itens exigem validação operacional separada.

Os testes estáticos e de smoke cobrem contratos de código, não qualidade subjetiva dos modelos ou garantias de segurança. Erros e regressões devem ser diagnosticados pelo log da execução correspondente, sem remover ou enfraquecer testes para obter um status verde.
