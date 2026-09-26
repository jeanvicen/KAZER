# Arquitetura de pesquisa do KAZER

## Fluxo final

```text
Usuário → KAZER Brain → research_web → Research Orchestrator
                    → Search Tool → fontes públicas
                    → Browser Agent (Playwright + Chromium, quando disponível)
                    → Evidence Store em memória → Brain → resposta + citações
```

O Brain decide se deve pesquisar por meio de tool-calling. Perguntas simples podem ser respondidas sem pesquisa; pedidos explícitos, informações atuais, preços, notícias, comparações e páginas específicas devem usar `research_web`.

## Componentes

- `api/_research-orchestrator.js`: coordena consultas, páginas visitadas, ações, limites, erros e evidências.
- `api/_research-browser.js`: Browser Agent real baseado em `playwright-core`; abre páginas, executa JavaScript, extrai texto/headings/links, encontra texto, clica, rola, navega no histórico, abre/fecha abas e captura screenshots.
- `api/research.js`: endpoint autenticado do novo fluxo, com rate limit, créditos, fontes e evidências.
- `api/chat.js`: expõe a ferramenta `research_web` ao Brain e devolve `research_used` para observabilidade.
- `interface/chat.html`: o WebKazer direto agora usa `/api/research`.
- O antigo endpoint `api/web-search.js` foi removido após a validação. O parser foi renomeado para `api/_research-search-utils.js` e agora é apenas um adaptador interno de descoberta usado pelo Search Tool.

## Pesquisa em múltiplas etapas

O fluxo normal permite até 3 consultas, 8 páginas e 12 ações de navegador. A pesquisa profunda permite até 6 consultas, 15 páginas e 25 ações. Cada fonte é descoberta, aberta, extraída e registrada; se uma fonte falhar, o orquestrador continua com outra e registra o erro. O fallback HTTP é limitado e não é tratado como equivalente ao navegador.

## Evidências e citações

Cada evidência registra URL real, título, texto relevante, passagem, consulta, horário, `pageRead` e se o Chromium foi usado. O Brain recebe as evidências como dados externos não confiáveis e só deve citar fontes presentes na lista retornada. URLs e conteúdos são sanitizados antes de sair pela API; segredos são removidos.

## Segurança

O Browser Agent valida o destino inicial e cada requisição de sub-recurso/redirecionamento. Bloqueia localhost, loopback, redes privadas, link-local, metadata endpoints, hosts `.local`/`.internal`, portas não padrão, credenciais embutidas e protocolos que não sejam HTTP(S). Conteúdo da Internet nunca pode alterar prompts, credenciais, permissões ou ferramentas.

## Deploy

`playwright-core` não inclui um navegador. Em um runtime com Chromium instalado, configure `KAZER_BROWSER_EXECUTABLE_PATH` (por exemplo `/usr/bin/chromium`). A Vercel pode executar o endpoint sem Chromium usando o fallback HTTP limitado; para navegação JavaScript completa em produção, hospede um Browser Worker separado com Chromium e faça a integração autenticada antes de habilitar tráfego real. O restante do KAZER continua funcionando se o navegador estiver indisponível.

## Testes

`npm run check` executa segurança, regressões de chat, compatibilidade da pesquisa e regressões do Research Orchestrator. O teste do orquestrador verifica SSRF, metadata endpoint, `file://`, limites, tool definition e execução real do Browser Agent quando o Chromium está disponível localmente.
