# Auditoria end-to-end do KAZER

**Escopo auditado:** repositório `jeanvicen/KAZER`, commit `7a08b6d3e5f37b2d137bb2263e4a306bf48c403d`, documentação operacional no Notion e catálogo de modelos disponível via API nesta sessão. **Data da auditoria:** 17 de setembro de 2026.

## Conclusão executiva

O KAZER é uma aplicação web/PWA estática hospedada na Vercel, com funções serverless Node.js e Supabase como camada de autenticação e persistência. A base técnica está mais madura do que um protótipo: existe autenticação server-side nas rotas principais, RLS/`FORCE ROW LEVEL SECURITY` nas migrações, criptografia AES-GCM para tokens de conectores, limites técnicos de payload, cabeçalhos de segurança, testes smoke/regressivos e documentação de operação.

A auditoria encontrou e corrigiu dois problemas reais. O fluxo GitHub havia regredido para inserir o token de sessão Supabase na URL; isso podia fazer webviews abrirem o próprio KAZER em vez da tela OAuth e expunha o token a histórico, logs e referências. O frontend agora chama `/api/github-connect` com `Authorization` e só navega para a URL OAuth retornada. Também foi adicionada uma verificação de DNS para MCPs remotos, reduzindo o risco de um domínio externo resolver para endereço privado.

Os riscos restantes não são um bypass de RLS confirmado, mas a validação do banco real, o rate limit não distribuído e a necessidade de validar o deploy real. A rodada de 22 de setembro de 2026 removeu a política de créditos, saldo, recarga e anexos do produto; a confirmação operacional da migração corretiva ainda é necessária. O backend agora respeita `SUPABASE_URL` e `SUPABASE_ANON_KEY`; em `NODE_ENV=production`, não aceita mais fallback embutido. A chave dedicada `KAZER_CONNECTOR_ENCRYPTION_KEY` também é obrigatória e deve ter pelo menos 32 caracteres em produção. A validação operacional com duas contas Supabase, tokens reais, webviews e domínio Vercel ainda depende de um ambiente público autenticado.

## 1. Arquitetura e inventário

A interface está em `interface/`, com `login.html`, `chat.html`, `kazer-workspace.js` e a central de documentos. O backend serverless está em `api/`, incluindo chat, pesquisa web, memória, retenção, Google Drive, GitHub, MCPs e tarefas. As migrações incrementais ativas do Supabase estão em `database/supabase/001`–`004`, `009`–`013`, `015`, `017` e `018`; a 018 remove estruturas legadas de consumo. O diretório `download/` contém PWA, service worker, manifesto, ícones e um empacotamento Android TWA; `download/ios/` é apenas preparação documental. Os scripts em `scripts/` cobrem segurança, chat, MCP, OAuth, memória, uso e APIs.

O chat mantém o histórico textual na sessão da página e não possui upload ou processamento de anexos. O WebKazer pesquisa fontes públicas e resume server-side. GitHub usa OAuth com state assinado, token criptografado e consultas filtradas por usuário. MCPs remotos são configurados por usuário, com segredos cifrados e descoberta de ferramentas. A memória é estruturada por categoria, possui deduplicação no backend, limite de 5.000 registros e RLS operacional via acesso server-side.

## 2. Segurança

### Controles confirmados

- Nenhuma chave privada de Groq, Gemini, GitHub, Supabase `service_role` ou chave privada foi encontrada no estado atual ou na varredura de padrões do histórico Git.
- A chave Supabase `anon` aparece no cliente e em fallback server-side. Isso é aceitável como chave pública, desde que RLS permaneça aplicado; não substitui autorização.
- Chat, pesquisa, memória, conectores e tarefas validam bearer token no Supabase Auth. Rotas de conectores e tarefas usam `requireUser`, que combina origem, Fetch Metadata e autenticação.
- Migrações aplicam RLS e `FORCE ROW LEVEL SECURITY` às tabelas sensíveis; a 018 remove tabelas e RPCs legadas de consumo. Funções `SECURITY DEFINER` usam `set search_path = public` e os grants foram reduzidos.
- Tokens de GitHub/MCP/Drive são armazenados cifrados com AES-256-GCM. A resposta ao cliente remove o payload secreto.
- Há limites de corpo, caracteres, respostas externas, timeout e rate limit por IP/usuário. O rate limit atual é best effort por instância serverless.
- O frontend escapa conteúdo dinâmico antes de `innerHTML`; mensagens e bolhas de chat usam texto escapado. A CSP restringe origens externas, embora ainda permita `unsafe-inline` para scripts e estilos por causa da arquitetura HTML atual.

### Vulnerabilidades e melhorias

| Severidade | Achado | Situação | Recomendação |
|---|---|---|---|
| Alta | Token Supabase era enviado em `/api/github-authorize?access_token=...`. | **Corrigido** em `interface/kazer-workspace.js`; endpoint legado agora rejeita GET/query token. | Manter regressão OAuth no CI e remover o endpoint legado após confirmar que nenhuma versão antiga o utiliza. |
| Média | MCP remoto validava HTTPS e bloqueava IP literal privado, mas não verificava o IP resolvido pelo DNS. | **Corrigido** com `dns.lookup(..., {all:true})` antes da chamada. | Em produção, considerar egress proxy/allowlist ou resolução conectada ao socket para eliminar também a janela de DNS rebinding. |
| Média | Rate limit em memória não é distribuído entre instâncias Vercel. | Pendente operacional. | Adotar limite distribuído ou proteção nativa do provedor antes de tráfego público relevante; medir custo por usuário e por IP. |
| Média | A chave `KAZER_CONNECTOR_ENCRYPTION_KEY` era opcional e podia cair para `SUPABASE_SERVICE_ROLE_KEY`. | **Corrigido no código:** produção rejeita ausência ou chave menor que 32 caracteres. | Configurar a chave real no ambiente Vercel e testar rotação/recriptografia. |
| Média | `profiles_directory_read` usa `using (true)` para permitir Conversas diretas. | Não é bypass acidental; é uma decisão de produto com exposição de `id` e `display_name` a usuários autenticados. | Confirmar se o diretório global é desejado. Preferir busca limitada, opt-in e exposição mínima. |
| Baixa | CSP ainda permite `unsafe-inline`. | Reduz a proteção contra XSS futuro. | Migrar gradualmente para scripts externos com nonce/hash; manter escaping e testes atuais. |
| Baixa | URL/chave pública Supabase tinha fallback server-side também em produção. | **Corrigido no código:** produção exige configuração explícita em autenticação e armazenamento; fallback ficou restrito ao desenvolvimento controlado. | Configurar e validar as variáveis reais no Vercel. |

## 3. QA e bugs

### Verificações executadas

`npm run security:check`, `npm run security:audit -- --audit-level=high` (**0 vulnerabilidades**), os smoke tests ativos (`api`, `github-oauth`, `mcp`), regressões de chat e memória, `node --check` em todas as APIs e `git diff --check` passaram. A entrega HTTP local de login, chat, manifesto e service worker respondeu `200`. Também foi validado que produção falha sem configuração Supabase explícita e sem chave dedicada de criptografia.

A análise responsiva está coberta no CSS por breakpoints móveis, `dvh`, safe-area, workspace lateral e layout desktop. O código foi inspecionado para mobile, tablet e desktop, mas não houve execução visual real em iOS Safari, Android Chrome, desktop Chromium/Firefox/Safari nem teste com leitor de tela. Esses testes exigem um preview público ou ambiente WebView e devem ser tratados como pendência operacional, não como aprovação.

### Correção aplicada

O fluxo GitHub agora é:

1. `kazer-workspace.js` chama `GET /api/github-connect` usando bearer no cabeçalho.
2. O backend autentica a sessão, cria state assinado, grava cookie HttpOnly e devolve a URL oficial do GitHub.
3. O navegador navega para `https://github.com/login/oauth/authorize?...` sem carregar token Supabase na URL.
4. O callback troca o code, grava o token GitHub cifrado e retorna ao `/chat`.

Foi adicionada uma regressão que falha se o frontend voltar a construir `github-authorize?access_token=` ou se o endpoint legado aceitar GET com token de query.

### Pendências de teste que exigem Jean

Aprovar uma janela de teste com duas contas Supabase e ambiente Vercel real; confirmar as migrações aplicadas; testar login, logout, sessão expirada, memória cruzada, chat textual, migração corretiva, conectores MCP, GitHub em webview iOS/Android e navegação externa. Também é necessário decidir se a política de diretório público de perfis é intencional.

## 4. Remoção dos controles de consumo e revisão do Supabase

A implementação atual não mantém créditos, saldo, recargas, catálogo de planos, RPCs de consumo ou anexos no chat. A migração `018_remove_consumption_controls.sql` remove essas estruturas em ambientes que ainda as possuam e preserva Auth, perfis, preferências, memórias, conectores, tarefas e conversas.

O README de `database/supabase` foi alinhado para documentar a migração `018_remove_consumption_controls.sql`. A confirmação do estado real do projeto Supabase continua pendente porque a credencial disponível retornou HTTP 401 e a ferramenta SQL conectada não tinha projeto ativo; não foi seguro executar SQL sem autenticação válida.

## 5. Modelo atual e recomendação de migração

No commit auditado, o padrão é `openai/gpt-oss-120b` via API Groq, com fallback `qwen/qwen3.6-27b`; o nome “Llama” não corresponde ao default efetivo deste estado do código. O wrapper é relativamente isolado: modelos, retries, visão e custos estão concentrados em `api/chat.js` e `.env.example`.

O catálogo API consultado nesta sessão oferece `gpt-5-mini` por US$ 0,25/1M tokens de entrada e US$ 2/1M de saída, com ferramentas, visão, JSON Schema, raciocínio, contexto de 400k e até 128k de saída. `gpt-5` custa US$ 1,25/10 e é a opção de maior qualidade para coding/reasoning. `gemini-3-flash-preview` custa US$ 0,50/3 e é atraente para multimodalidade e contexto longo. Esses valores são do catálogo vivo consultado, não uma promessa de preço futuro.

**Recomendação:** não substituir tudo por um único modelo premium. Migrar para uma arquitetura roteada:

- `gpt-5-mini` como padrão de chat e tarefas comuns;
- `gpt-5` somente para operações explicitamente complexas, coding profundo, revisão de repositório ou fallback de qualidade;
- `gemini-3-flash-preview` para pesquisa e contexto longo, sujeito a teste de qualidade;
- manter Groq como caminho de baixa latência/fallback até o benchmark confirmar equivalência.

A migração deve introduzir um adaptador de provedor, testes dourados de 50–100 prompts reais anonimizados, métricas de latência, taxa de erro, custo por operação, qualidade de código e satisfação. O orçamento operacional deve ser acompanhado por observabilidade e limites do provedor, sem criar saldo ou cobrança no produto. Como o proxy GPT não expõe streaming nesta sessão, o efeito visual progressivo atual teria de continuar sendo simulado ou implementado via outro provedor.

## 6. Direção estratégica

A oportunidade do KAZER não é competir em “responder qualquer coisa” contra seis plataformas maiores. É ser um **workspace pessoal de desenvolvimento com memória controlável, conectores auditáveis e operações honestas**. As prioridades são: memória exportável e apagável com trilha clara; modo “revisar antes de executar” para MCP/GitHub; diff e plano antes de qualquer alteração; permissões por repositório e ferramenta; orçamento por tarefa; logs legíveis sem segredos; e um benchmark público de qualidade/custo.

O diferencial de confiança deve ser visível: cada ação conectada precisa indicar conector, escopo, repositório, ferramenta, custo estimado e resultado. O KAZER deve oferecer um modo local/privado para arquivos sensíveis, controles de retenção compreensíveis, importação/exportação de memória em formato aberto e uma camada de compatibilidade MCP que permita ao desenvolvedor levar suas ferramentas sem ficar preso a um fornecedor.

## 7. Roadmap priorizado

| Prioridade | Entrega | Critério de conclusão |
|---|---|---|
| P0 | Aplicar limpeza de consumo | Aplicar a migração 018 e validar que Auth, perfis, tarefas e conectores continuam íntegros |
| P0 | Fechar OAuth GitHub corrigido no domínio real | GitHub abre em desktop, Android WebView/TWA e iOS Safari; nenhum token em URL/log |
| P0 | ~~Tornar chave de criptografia dedicada obrigatória~~ | **Concluído no código:** produção rejeita chave ausente/fraca; falta configurar e validar rotação no ambiente real |
| P0 | Validar migração 018 no Supabase real | Tabelas e RPCs legadas removidas sem afetar as tabelas de conta e integração |
| P1 | Rate limit distribuído | Rajadas concorrentes não ultrapassam limites técnicos por IP/usuário |
| P1 | Teste visual automatizado em breakpoints e navegadores | Capturas aprovadas para 375×812, 768×1024 e 1440×900, com foco/teclado |
| P1 | Roteador de modelos com benchmark dourado | Política de seleção baseada em qualidade, latência e custo medidos |
| P1 | Permissões de conectores e aprovação de ferramentas | Usuário autoriza servidor/ferramenta/ação individualmente |
| P2 | Memória exportável, explicável e com controles de retenção | Usuário vê, exporta, apaga e entende quando uma memória foi usada |
| P2 | Diff/plano/auditoria para GitHub | Nenhuma alteração é alegada sem operação confirmada e evidência |
| P2 | Programa de desenvolvedores | Docs de API/MCP, exemplos, changelog, templates e casos reais de uso |

## Referências

[1]: https://github.com/jeanvicen/KAZER "Repositório KAZER"
[3]: https://app.notion.com/p/79a7df0eeb4d4844ab0eed46c4133d2f "Sistema de Memória Individual — Kaser AI"
[4]: https://app.notion.com/p/4b493fddeee3444ab0eed46c4133d2f "Sistema de trabalho do agente"
[6]: https://console.groq.com/docs/models "Groq — Supported Models"
[7]: https://developers.openai.com/api/docs/pricing "OpenAI API Pricing"
[8]: https://platform.claude.com/docs/en/models/overview "Anthropic Claude Models Overview"
[9]: https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/ "OWASP API4: Unrestricted Resource Consumption"
[10]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase Row Level Security"
