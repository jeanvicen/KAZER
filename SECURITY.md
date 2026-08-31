# Segurança do KAZER

**Versão:** 1.0
**Última revisão:** 29 de agosto de 2026
**Escopo:** interface web/PWA, APIs serverless, integrações Supabase/Groq/Gemini, banco e job de retenção.

Este documento registra a análise do repositório KAZER contra os 20 critérios de segurança solicitados. Ele descreve controles verificáveis no código e separa o que depende de configuração do Vercel, Supabase ou dos provedores externos. A existência deste arquivo não constitui certificação, pentest ou garantia de invulnerabilidade.

> **Regra essencial:** chaves privadas de provedores, `service_role`, `sb_secret` e `CRON_SECRET` devem existir somente nas variáveis privadas do servidor. A chave `anon`/publicável do Supabase é de baixo privilégio e pode aparecer no navegador, mas nunca substitui RLS e grants mínimos.[^2] [^3]

## Resultado executivo

A auditoria encontrou controles parciais já existentes e adicionou uma camada compartilhada para autenticação server-side, limitação de requisições, validação de payloads, leitura limitada de respostas externas, redaction de segredos e respostas sem cache. Também foram adicionadas políticas SQL de endurecimento, CSP/HSTS e verificação automatizada no CI.

Os itens que ainda exigem ação operacional são a aplicação das migrações Supabase, a configuração privada das variáveis no Vercel, a confirmação de HTTPS no domínio de produção, o gerenciamento de chaves e a decisão explícita sobre habilitar exclusões permanentes de contas. O controle anti-bot não usa CAPTCHA neste momento; a proteção atual é composta por autenticação, metadados de origem, limites e rate limiting.

## Matriz dos 20 critérios

| # | Critério | Situação | Evidência e medida aplicada |
|---:|---|---|---|
| 1 | Esconder API keys | **Implementado com ressalva** | `GROQ_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` são lidos no servidor. A chave Supabase `anon` permanece no cliente porque é uma chave pública de baixo privilégio; RLS continua obrigatório. |
| 2 | Limpar secrets do Git | **Implementado no estado atual + script local** | Foi feita varredura do histórico e do estado atual por chaves de provedor, tokens GitHub, blocos de chave privada, `service_role` e `sb_secret`; não foram encontrados segredos privados. O comando `npm run security:check` torna essa verificação reproduzível antes de cada publicação. Se uma chave real já tiver sido exposta fora destes padrões, ela deve ser revogada e recriada. |
| 3 | Public key do banco | **Implementado** | O navegador usa apenas a chave pública `anon` do Supabase. Não há `service_role` no HTML, no PWA ou no Kazer Coder. |
| 4 | Ativar RLS | **Implementado no SQL; aplicar no ambiente** | As migrações 001 e 003 habilitam RLS e policies por `auth.uid()`. A nova `004_security_hardening.sql` adiciona `FORCE ROW LEVEL SECURITY`, revoga grants desnecessários e restringe funções; as migrações 005–008 adicionam uso, créditos, resets e contagem de anexos. Execute as oito migrações na ordem indicada. |
| 5 | Criptografia de dados | **Parcial, com TLS aplicado** | As integrações usam HTTPS; a configuração adiciona HSTS e `upgrade-insecure-requests`. A criptografia em repouso do Supabase, Vercel e provedores externos depende das configurações e garantias desses serviços e não foi presumida como verificada pelo código. O KAZER não implementa criptografia adicional de mensagens em banco próprio. |
| 6 | Auth server-side | **Implementado para APIs próprias** | `/api/chat` e `/api/web-search` exigem bearer token e validam o usuário no endpoint `/auth/v1/user` do Supabase. `/api/retention` exige `CRON_SECRET` comparado de forma segura. O acesso direto do cliente ao Supabase continua protegido por Auth + RLS. |
| 7 | Restringir acessos | **Implementado** | Grants de tabelas e execução de funções são mínimos; policies restringem linhas ao usuário. APIs recusam métodos, origens/metadados de navegação inadequados e sessões inválidas. Tabelas de avisos/manutenção são somente leitura pública por decisão funcional explícita. |
| 8 | Bloquear mass assignment | **Implementado** | SQL permite atualizar apenas colunas de preferência e `display_name`; IDs e linhas não podem ser inseridos/apagados pelo cliente. As APIs aceitam somente roles `user`/`assistant`, campos de anexos previstos e modos de pesquisa permitidos. |
| 9 | Proteger cookies/sessão | **Parcial por arquitetura** | O app não cria cookies próprios. O Supabase JS persiste a sessão no armazenamento do navegador; o token não é colocado na URL, `detectSessionInUrl` foi desativado e o logout chama `signOut`. Para garantia de cookie `HttpOnly` seria necessário migrar a sessão para um backend que emita cookies; isso não faz parte da arquitetura estática atual. |
| 10 | Hash nas senhas | **Delegado ao Supabase Auth** | A senha é enviada somente ao fluxo `signUp`/`signInWithPassword` do Supabase Auth; o KAZER não grava senha nem hash em tabelas próprias. A regra local exige pelo menos 10 caracteres, uma maiúscula e um caractere especial, sem substituir a validação do provedor. |
| 11 | Rate limit | **Implementado como best effort serverless** | Chat: 8 requisições/minuto por IP e 12/minuto por usuário. Pesquisa: 10/minuto por IP e 6/minuto por usuário. A camada comum adiciona `Retry-After` e cabeçalhos `X-RateLimit-*`. Como o Vercel serverless pode ter múltiplas instâncias, limites distribuídos exigem um armazenamento externo; os limites operacionais de custo dos provedores também devem ser configurados. |
| 12 | Bot protection | **Defesa em profundidade implementada; CAPTCHA pendente** | Autenticação, origem, Fetch Metadata, rate limit, limites de payload e timeouts reduzem automação abusiva. Não há CAPTCHA/Turnstile integrado; adicionar esse desafio é uma decisão de produto para tráfego público de maior risco. |
| 13 | Queries parametrizadas | **Implementado** | Consultas do cliente usam filtros Supabase (`eq`, `is`, `order`, `limit`) e o job codifica parâmetros ao montar URLs REST. A pesquisa web consulta somente provedores fixos; nenhum URL controlado pelo usuário é buscado pelo servidor. |
| 14 | Validação dos inputs | **Implementado** | Há limites de corpo, mensagens, caracteres totais, modos de pesquisa, número/tipo/tamanho de anexos, nomes de arquivo, senha, nome e e-mail. Os limites são verificados no cliente e novamente no servidor. |
| 15 | Evitar vazamento de conteúdo | **Implementado com transparência de fluxo** | Erros internos não são devolvidos diretamente; logs removem tokens/chaves; respostas do modelo removem blocos de raciocínio, referências a infraestrutura e padrões comuns de tokens. Resultados web são escapados antes do HTML. O conteúdo solicitado ainda pode ser enviado ao provedor de IA necessário à função, conforme a política de privacidade. |
| 16 | Restringir uploads | **Implementado** | O servidor aceita no máximo 10 anexos por envio, 4 MB por arquivo e 4 MB no total do envio, 3 imagens e tipos de imagem, texto, PDF e DOCX explicitamente permitidos. O nome é normalizado, arquivos são processados em memória e texto extraído é truncado. |
| 17 | Trim das respostas de API | **Implementado** | Respostas externas têm timeout e limite de bytes; conteúdo extraído é limitado; respostas do chat são limitadas a 12.000 caracteres e o resumo web a 4.000 caracteres. APIs próprias retornam JSON sem cache. |
| 18 | Security headers | **Implementado no Vercel** | `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` e `X-DNS-Prefetch-Control` foram adicionados. A CSP restringe scripts, fontes, conexões e frames.[^4] |
| 19 | Forçar HTTPS | **Implementado para produção Vercel; validar domínio** | HSTS e `upgrade-insecure-requests` foram configurados e todos os upstreams usam HTTPS. Confirme no domínio de produção que o redirecionamento HTTP→HTTPS do Vercel está ativo antes de divulgar o endereço. |
| 20 | Scan de dependências | **Implementado via script local** | `npm run security:audit` executa `npm audit --omit=dev`; a auditoria atual não reportou vulnerabilidades. Recomenda-se executar o comando em cada push e pull request. Dependências devem continuar presas ao `package-lock.json`. |

## Arquivos principais alterados

| Arquivo | Finalidade |
|---|---|
| `SECURITY.md` | Registro central dos 20 critérios, limites, evidências e pendências operacionais. |
| `api/_security.js` | Autenticação Supabase, origem, Fetch Metadata, rate limit, limites de corpo, timeout/leitura limitada, comparação segura e redaction. |
| `api/chat.js` | Auth server-side, rate limit, allowlist de anexos, normalização de nomes, limite de saída e timeout do provedor. |
| `api/web-search.js` | Auth server-side, rate limit, validação de modo, timeout e limite dos provedores de busca/resumo. |
| `api/retention.js` | Comparação segura do cron, URL Supabase validada, respostas limitadas e flag explícita para exclusões. |
| `database/supabase/004_security_hardening.sql` | `FORCE RLS`, grants mínimos, constraint de nome e revogação de funções internas. |
| `vercel.json` | CSP, HSTS, isolamento de origem, Permissions Policy, framing e respostas sem cache em API. |
| `download/sw.js` | Cache somente do app shell conhecido, sem fallback genérico para rotas privadas. |
| `scripts/security-check.mjs` | Verificação reproduzível de padrões de segredo, headers, RLS, limites e sintaxe. |

## Implantação segura obrigatória

Antes de publicar, configure como variáveis **privadas** no Vercel `GROQ_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET`. Configure também `PUBLIC_APP_ORIGINS` com a origem HTTPS exata, sem barra final. Não copie nenhum desses valores para HTML, documentação pública, logs ou parâmetros de URL.

Execute as migrações Supabase na ordem `001_auth_accounts.sql`, `002_inactivity_retention.sql`, `003_retention_notifications.sql`, `004_security_hardening.sql`, `005_usage_limits.sql`, `006_usage_rpc_fix.sql`, `007_credits_150_messages_5h.sql` e `008_attachment_limit_10_items.sql`. Depois, teste com duas contas: cada usuário deve ler e alterar somente seu próprio perfil, preferências, uso e notificações; uma conta não deve acessar o registro da outra; e nenhuma sessão deve chamar as APIs sem bearer válido.

Mantenha `RETENTION_DELETE_ENABLED=false` até revisar backup, avisos, suporte e procedimento de recuperação. A exclusão administrativa é permanente. Só altere para `true` após um teste controlado e uma confirmação operacional independente.

## Verificações locais

```bash
npm ci --ignore-scripts
npm run security:check
npm run security:audit -- --audit-level=high
```

Não execute o job de retenção com credenciais reais durante testes sem confirmar previamente o valor de `RETENTION_DELETE_ENABLED`. Ao detectar exposição de chave privada, revogue-a imediatamente no provedor, gere uma nova e revise os logs e o histórico do repositório.

## Referências

[^1]: [OWASP API4:2023 — Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
[^2]: [Supabase — Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys)
[^3]: [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
[^4]: [MDN — Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)


## Controles solicitados nesta revisão

| Requisito | Implementação atual | Local/evidência |
|---|---|---|
| Esconder chaves | As chaves privadas da IA (`GROQ_API_KEY` e `GEMINI_API_KEY`) são lidas somente em funções serverless. O navegador usa apenas a chave pública anon do Supabase, protegida por Auth e RLS. | `api/chat.js`, `api/web-search.js`, `interface/login.html`, `.env.example` |
| Rate limit | O chat aplica limites por IP e por usuário autenticado; a pesquisa web também aplica limites separados e envia cabeçalhos `X-RateLimit-*` e `Retry-After`. | `api/_security.js`, `api/chat.js`, `api/web-search.js` |
| Bloqueio XSS | Mensagens do usuário são inseridas com `textContent`; respostas e resultados web são escapados antes de qualquer `innerHTML`. O backend remove caracteres de controle e limita payloads e respostas. | `interface/chat.html`, `api/chat.js`, `api/web-search.js` |
| Prompt injection | O prompt server-side trata mensagens, anexos e resultados de pesquisa como dados não confiáveis e instrui a IA a ignorar tentativas de alterar regras, revelar o prompt ou assumir outra identidade. | `api/chat.js`, `api/web-search.js` |
| Autenticação | As APIs exigem bearer token de sessão e validam o token no endpoint Auth do Supabase antes de processar a solicitação. | `api/_security.js`, `api/chat.js`, `api/web-search.js` |
| Moderação da IA | Pedidos com padrões operacionais de violência, fabricação de armas/explosivos, invasão, malware, roubo, fraude e crimes são bloqueados antes da chamada ao provedor. | `api/chat.js` (`HIGH_RISK_PATTERNS`) |
| HTTPS | A configuração da Vercel usa HSTS, `upgrade-insecure-requests`, CSP e conexões HTTPS para os serviços externos. A confirmação do domínio de produção continua sendo operacional. | `vercel.json` |

A moderação baseada em padrões é uma camada preventiva local, não substitui políticas de uso, revisão humana ou filtros especializados do provedor. A proteção contra prompt injection é uma instrução de defesa em profundidade; nenhum modelo deve ser considerado capaz de eliminar esse risco sozinho. O rate limit em memória é best effort em funções serverless; para limites distribuídos entre instâncias, use armazenamento compartilhado ou controles nativos do provedor.

Antes de produção, mantenha todas as chaves privadas como variáveis secretas na Vercel, aplique as migrações Supabase, confirme o domínio HTTPS, configure `PUBLIC_APP_ORIGINS` e execute `npm run security:check` e `npm run security:audit -- --audit-level=high`.


## Checklist complementar incorporado

Esta seção consolida os itens adicionais do checklist recebido e não substitui os controles técnicos descritos acima. Um item marcado como **pendente** não deve ser tratado como implementado apenas porque está documentado.

### 1. Secrets e chaves

**Implementado:** chaves privadas da IA, tokens administrativos e segredos de cron ficam no backend por variáveis privadas da Vercel; não são colocados no frontend. O repositório possui verificação automatizada para padrões comuns de chaves e tokens. O uso de ambientes separados de desenvolvimento e produção é uma **recomendação operacional pendente**, que deve ser configurada na Vercel.

**Procedimento em caso de exposição:** revogar imediatamente a chave comprometida, emitir uma nova, revisar logs, verificar o histórico Git e atualizar somente as variáveis secretas do ambiente. Senhas, tokens, cookies e API keys nunca devem ser registrados em logs.

### 2. Autenticação, autorização e sessões

**Implementado:** as rotas privadas de chat e pesquisa validam no servidor o bearer token da sessão Supabase; o usuário é identificado pelo token validado, não por `user_id` enviado pelo cliente. O Supabase Auth administra expiração, revogação, login, cadastro e recuperação de senha.

**Pendente de teste operacional:** testar explicitamente acesso sem login, token inválido, token expirado, sessão revogada e tentativas de alterar identificadores de usuário, mensagens, memórias ou arquivos. O app não possui uma camada própria de JWT nem cookies `HttpOnly`; utiliza o token de sessão do Supabase conforme a arquitetura atual.

### 3. Autorização, banco, memória e RAG

**Implementado:** as migrações SQL habilitam RLS, policies por `auth.uid()` e grants mínimos. As APIs não aceitam um identificador de usuário para escolher a identidade autenticada.

**Não aplicável no fluxo atual:** o KAZER não possui atualmente um sistema próprio de memória persistente ou RAG de documentos por usuário. Se esse recurso for adicionado, cada registro deverá ter proprietário/tenant, verificar autorização antes de ler/alterar/apagar e tratar conteúdo recuperado como não confiável.

### 4. Rate limiting e abuso

**Implementado:** chat e pesquisa possuem limites por IP e por usuário autenticado, limites de corpo, limites de anexos e timeouts. **Parcial:** login, cadastro e recuperação de senha são executados pelo Supabase Auth e dependem dos limites e proteções configurados nesse serviço; não há um endpoint próprio do KAZER para pagamentos, créditos ou criação de tokens.

O rate limit em memória é best effort em serverless e não substitui limite distribuído do provedor. Antes de produção, deve-se testar rajadas simultâneas, abuso de anexos e consumo excessivo de recursos.

### 5. Segurança da IA e prompt injection

**Implementado:** instruções internas são separadas dos dados do usuário; mensagens, anexos e resultados de pesquisa são tratados como não confiáveis; o prompt ordena ignorar tentativas de alterar regras, revelar instruções internas, assumir outra identidade ou executar ações não autorizadas. O endpoint não expõe ferramentas gerais ao modelo e não contém secrets no prompt.

**Pendente de teste autorizado:** tentar prompt injection, exfiltração de contexto, manipulação de conteúdo recuperado e solicitações de ações não permitidas em ambiente controlado. A proteção por prompt é defesa em profundidade e não é garantia absoluta.

### 6. API, injection, XSS e SSRF

**Implementado:** inputs são validados no backend, corpos e respostas têm limites, upstreams têm timeout, métodos e origens são restringidos, erros não devolvem detalhes internos, consultas de banco usam filtros/queries parametrizadas e conteúdo exibido no navegador é escapado.

**SSRF:** o servidor consulta somente provedores de busca fixos e não acessa URLs arbitrárias fornecidas pelo usuário. URLs retornadas como fontes são apresentadas ao cliente, não buscadas pelo servidor como destino controlável pelo usuário.

### 7. Uploads

**Implementado:** há allowlist de tipos, validação de MIME/extensão, limite de tamanho, limite de quantidade, normalização de nomes, processamento em memória e extração limitada. Arquivos enviados não são executados.

**Pendente se o produto ganhar armazenamento persistente:** associar cada arquivo ao usuário/tenant, validar autorização em toda leitura, manter armazenamento privado e testar extensão falsa, MIME inesperado e nomes malformados.

### 8. Pagamentos, webhooks e administração

**Não aplicável ao fluxo atual:** não existem endpoint de pagamentos, webhook de cobrança, carteira de créditos ou painel administrativo no escopo atual. Caso sejam adicionados, deverão validar assinatura no backend, usar idempotência, manter o servidor como fonte de verdade, aplicar menor privilégio e registrar ações administrativas sem expor dados sensíveis.

### 9. Logs, headers e HTTPS

**Implementado:** respostas de API não usam cache, erros devolvidos ao cliente são genéricos, a configuração aplica CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, Permissions Policy, isolamento de origem e `upgrade-insecure-requests`. O código não registra chaves, tokens ou senhas.

**Pendente de operação:** centralizar alertas para falhas de autenticação, abuso, picos de uso e eventos administrativos, revisar retenção de logs e confirmar o redirecionamento HTTP para HTTPS no domínio de produção.

### 10. Dependências, CI/CD e backups

**Implementado:** `npm run security:check` verifica políticas, headers, autenticação, rate limit, moderação, prompt injection, RLS e padrões de secrets; `npm run security:audit -- --audit-level=high` verifica vulnerabilidades de dependências; o lockfile é versionado.

**Pendente de operação:** executar os comandos em cada push/pull request, revisar dependências novas e configurar proteção do pipeline. Backups e restauração são responsabilidade da infraestrutura Supabase/Vercel e devem ser configurados, protegidos e testados separadamente; não há backup próprio implementado pelo KAZER.

## Roteiro mínimo de validação antes de produção

1. Testar APIs sem login, com token inválido, expirado e revogado.
2. Testar isolamento entre duas contas e confirmar que IDs enviados pelo cliente não alteram a identidade autenticada.
3. Enviar requests grandes, tipos inesperados, muitas mensagens, muitos anexos e múltiplas requisições simultâneas.
4. Testar HTML, Markdown e conteúdo malicioso vindo do usuário, da IA, de fontes web e de anexos.
5. Testar tentativas de prompt injection sem usar dados reais ou ações destrutivas.
6. Confirmar headers HTTPS no domínio de produção e revisar logs para garantir ausência de secrets.
7. Executar `npm run security:check` e `npm run security:audit -- --audit-level=high` antes de cada publicação.
8. Aplicar e testar as migrações Supabase em ambiente controlado; manter `RETENTION_DELETE_ENABLED=false` até concluir o procedimento de backup e restauração.
