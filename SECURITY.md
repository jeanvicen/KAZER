# Segurança do KAZER

**Escopo:** revisão estática do código e das migrações versionadas do repositório `jeanvicen/KAZER`; não é pentest, auditoria de produção nem certificação. Os apontamentos de implementação abaixo foram rechecados no commit `0b9e9d87d587b670d9393b6ce7de2063440efad3` (6 out. 2026). Configurações externas e o schema efetivamente implantado não foram verificados dinamicamente.

> Esta documentação separa controles observados de riscos ainda pendentes. Um controle no repositório não prova que as variáveis, políticas do Supabase ou configurações Vercel estejam iguais em produção.

## Controles presentes no código

- As rotas privadas verificam bearer token com Supabase Auth e aplicam validações server-side. As chaves privadas dos provedores e a service role são destinadas ao servidor; a chave publicável Supabase, por definição, não substitui RLS.
- Há limites de payload, timeout e leitura de respostas externas; validações de método/origem e rate limiting por processo. O service worker atual usa cache versionado e associa ícones pelo caminho do manifesto.
- O transporte HTTP do MCP remoto e o fallback HTTP da pesquisa validam os endereços DNS públicos e fixam a conexão ao IP aprovado. O transporte MCP não segue redirects; o fallback HTTP de pesquisa valida manualmente cada destino de redirect e limita o número de saltos e bytes recebidos/decompactados.
- O fluxo GitHub OAuth assina o `state` e, no código revisado, não usa mais chave literal como fallback. A permissão de e-mail não é solicitada; a aplicação mantém `repo` para funcionalidades de descoberta/contexto de repositórios privados.
- A CSP configurada em `vercel.json` restringe origens, mas ainda permite `'unsafe-inline'` em scripts e estilos por compatibilidade com blocos inline existentes.
- As regressões estáticas e o CI avaliam o código versionado atual. O scanner não é uma varredura forense de todo o histórico Git.

A auditoria npm deve ser conferida por execução/commit. Na execução CI de `0b9e9d8`, testes e `npm run check` passaram, mas a etapa de smoke tests falhou antes da auditoria npm. Na execução bem-sucedida de `57ff139`, o comando `npm run security:audit -- --audit-level=high` passou no limite definido, mas o relatório mostrou **três ocorrências moderadas** no caminho transitivo `mammoth → argparse → sprintf-js` (DoS por especificador de precisão sem limite; GHSA-hp3w-g68c-fv3c). O comando sugeriu `npm audit fix --force`, que faria downgrade potencialmente incompatível de `mammoth`; não foi aplicado. Avaliar atualização/override compatível com testes de parsing DOCX antes de declarar a dependência limpa. O commit `d51f9ab` altera apenas documentação e não muda o lockfile.

## Riscos e pendências identificados

| Área | Observação e próxima validação segura |
|---|---|
| **Supabase: upgrades e instalação limpa** | A migração `016_security_rls_rpc_cleanup.sql` referencia objetos legados (`plan_catalog`, `user_usage` e RPCs anteriores) ausentes das migrações anteriores versionadas. A sequência não é baseline comprovada para banco vazio. `020_monthly_usage_percentage.sql` introduz a RPC atual. Documentar/testar um caminho de upgrade e bootstrap isolado; não inventar baseline nem aplicar SQL de produção sem aprovação. |
| **RLS e isolamento** | A revisão estática encontrou a maioria das políticas escopadas, mas não há teste automatizado cross-tenant de duas contas nem teste real de produção. Tabelas de mensagens diretas não usam `FORCE ROW LEVEL SECURITY`; uma concessão `SELECT` anterior em `profiles` pode ser mais ampla do que o pretendido; handlers com service role precisam de filtro explícito por usuário. Revisar grants e testar IDs cruzados em um ambiente isolado. |
| **MCP remoto: saída HTTP** | `api/_ssrf.js` valida todos os endereços DNS retornados e usa `node:http`/`node:https` com `lookup` fixado no endereço público aprovado; em HTTPS, mantém o hostname original para SNI e verificação do certificado. Redirects MCP seguem bloqueados e corpos de requisição/resposta têm limites. Isso reduz a janela de DNS rebinding no transporte implementado, mas não substitui defesa de rede/egress nem valida configuração de produção. |
| **Pesquisa: fallback HTTP** | `api/_research-orchestrator.js` segue manualmente até três redirects, validando e fixando o destino antes de cada conexão. O transporte limita bytes recebidos e descompactados. A navegação Playwright em `api/_research-browser.js` ainda verifica DNS separadamente e depois deixa o Chromium resolver/conectar ao hostname; há risco residual de DNS rebinding/TOCTOU nesse caminho. |
| **MCP: autorização de ações e conteúdo** | A execução de ferramentas solicitadas pelo modelo não tem gate server-side de confirmação por ação nem validação completa de esquema de autorização. Resultados MCP podem carregar instruções maliciosas ou segredos. Uma solução requer desenho cuidadoso de UX/API, não desativação casual de ferramentas. |
| **Execução local e Browser Agent** | Valores `command` de MCP local não foram executados na auditoria. Computer KAZER aparenta planejamento, sem runner de produção encontrado. O Chromium de pesquisa pode ser lançado com `--no-sandbox`; a configuração efetiva do deployment não foi confirmada. |
| **OAuth GitHub** | O escopo `repo` é amplo, mas necessário para descoberta/contexto de repositórios privados; não remover essa funcionalidade sem alternativa. Não foi observada revogação remota do token ao desconectar; expiração do token não foi confirmada. O estado assinado pode ser aceito sem cookie em compatibilidade mobile. Testar ciclo de vida e informar claramente o comportamento. |
| **CSP** | `'unsafe-inline'` permanece; há blocos inline em login/chat/documentos e preview HTML gerado dentro de iframe sandbox. Removê-lo diretamente pode quebrar funcionalidades. Migrar por etapas (nonce/hash/externos) com testes antes de apertar a política. |
| **Rate limits** | Limites são mantidos em `Map` em memória por processo, não compartilhados globalmente entre instâncias serverless; `MAX_RATE_BUCKETS` não é limite rígido de memória. Usar storage distribuído e quotas do provedor se a escala/riscos justificarem. |
| **Logs** | Alguns caminhos de erro podem registrar texto bruto vindo de provider ou banco. Isso é risco de exposição de conteúdo/diagnóstico; não há evidência nesta revisão de que segredos tenham sido efetivamente registrados. Redigir/normalizar mensagens e revisar retenção de logs. |
| **Retenção e chaves operacionais** | RLS, secrets, cron, backups, HTTPS, variáveis Vercel e estado das migrações dependem também da configuração externa e não foram confirmados em produção. A exclusão de contas é irreversível; manter desativada até validar backup/restore e procedimento operacional. |

## Execução e status de validação

Para a suíte e limitações, consulte [`docs/testing.md`](docs/testing.md). O workflow `.github/workflows/ci.yml` executa testes, verificações, smoke tests e auditoria de dependências; status verde deve ser verificado no run do commit exato. Smoke tests locais não provam acesso real ao Supabase, RLS, OAuth em WebView, MCP de terceiros, configuração Vercel ou segurança sob ataque.

A revisão de 6 out. não acessou dados/schema de produção nem aplicou migrações. Não houve pentest, teste cross-account em Supabase ou confirmação dinâmica de deploy. Antes de uma liberação, validar em ambiente controlado: sessão válida/inválida, isolamento entre duas contas, origem e IDs manipulados, payloads grandes, uploads, erros/redação de logs, OAuth em mobile, MCP/research com redirects e configuração efetiva de headers.

## Relato responsável

Não inclua tokens, URLs assinadas ou dados de usuário em issues públicas. Encaminhe achados de segurança pelos canais privados indicados pelo projeto/organização e preserve evidências sem expor dados pessoais.
