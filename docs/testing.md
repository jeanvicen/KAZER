# Testes

## Verificação principal

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` executa:

- `security:check`: autenticação, limites, headers, RLS esperado, sintaxe e padrões de secrets;
- `chat:regression`: contratos de chat, anexos, PWA e preservação de mensagens que falharam;
- `web-search:regression`: intenção, opt-out, ranking, deduplicação e destinos seguros;
- `research:regression`: navegador opcional, SSRF, limites e evidências;
- `brain:regression`: pedidos com restrições, classificação de tarefa, seleção de histórico, prompt modular e ordem de providers.

## Integrações

Quando houver ambiente autorizado, execute `npm run integration:test`. Os testes de integração dependem de contratos/credenciais externos e não substituem a suíte local.

Não são considerados aprovados sem execução real: login com duas contas Supabase, deploy Vercel, OAuth GitHub em WebView, MCPs reais e testes visuais em navegadores móveis.
