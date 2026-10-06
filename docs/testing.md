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

- `npm test`: suíte Node.js (`node --test`) com regressões e compatibilidade de esquema.
- `npm run check`: verificações estáticas de segurança e regressões de chat, pesquisa, Brain e configuração relacionada.
- `npm run integration:test`: smoke tests para MCP, APIs/handlers, OAuth do GitHub e configuração de produção. Os testes usam stubs e segredos exclusivos de teste; não chamam contas reais nem validam implantação ou banco em produção.
- `npm run security:audit -- --audit-level=high`: auditoria npm das dependências de produção conforme o script `security:audit`.

## Integrações e limites

O workflow em `.github/workflows/ci.yml` executa `npm test`, `npm run check`, `npm run integration:test` e a auditoria npm em pushes para `main` e pull requests. O resultado é específico ao commit e deve ser conferido no [histórico do workflow](https://github.com/jeanvicen/KAZER/actions/workflows/ci.yml); um workflow existente não significa que toda execução recente passou.

Os testes automatizados não comprovam: isolamento real entre duas contas Supabase; conteúdo e estado do schema de produção; sucesso do deploy Vercel; OAuth do GitHub em WebView/mobile; comportamento de MCPs remotos reais; nem pentest, teste visual móvel ou auditoria de configuração externa. Esses itens exigem ambiente autorizado e validação operacional separada.

Os testes estáticos e de smoke cobrem contratos de código, não qualidade subjetiva dos modelos ou garantias de segurança. Erros e regressões devem ser diagnosticados pelo log da execução correspondente, sem remover ou enfraquecer testes para obter um status verde.
