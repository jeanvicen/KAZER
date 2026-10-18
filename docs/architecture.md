# Arquitetura e organização do KAZER

## Princípio de organização

O KAZER atual é um site estático/PWA publicado pela Vercel, com funções Node.js server-side, Supabase e aplicativos auxiliares próprios. As pastas da raiz refletem esses limites de execução e publicação — não são apenas agrupamentos visuais.

O `KAZER.V1` usa outro formato de monorepo (`kazer-web/`, `kazer-mobile/`, `kazer-core/`), com adaptadores documentados como mock/planejados. Essa estrutura é uma referência útil para separar responsabilidades, mas não deve ser copiada mecanicamente: transformar ou mover os diretórios do KAZER atual poderia quebrar rotas Vercel, URLs de assets, instalação PWA, builds móveis e workers. A regra é **organizar por responsabilidade sem alterar os contratos que já funcionam**.

## Mapa do repositório

O mapa completo, com responsabilidade de cada pasta e seus limites, está em [`repository-structure.md`](repository-structure.md). Visão resumida:

```text
KAZER/
├── api/                    Rotas serverless e adaptadores de compatibilidade
├── server/                 Implementações backend agrupadas por domínio
├── interface/              Páginas estáticas e código do navegador
├── mobile/                 App Expo que envolve o produto web
├── worker/                 Processo para tarefas em segundo plano
├── database/supabase/      Migrações e instruções do banco
├── skills/                 Skills e referências carregadas pelo Brain
├── scripts/                Verificações, smoke tests e manutenção
├── test/                   Testes automatizados
├── docs/                   Arquitetura, guias, políticas e auditorias
├── planos/                 Planejamento e pesquisa de produto
├── download/               Arquivos públicos, PWA, ícones e distribuição
├── Control/                Configuração/documentação de avisos globais
├── .github/                CI, Dependabot e propriedade do código
└── configuração na raiz    package.json, vercel.json, .env.example etc.
```

## Fluxos principais

### Chat e ferramentas

```text
interface/chat.html
    → POST /api/chat
    → autenticação, origem, limites e validação de anexos
    → intenção, histórico e plano de capacidades
    → Skill permitida + Brain
    → pesquisa/MCP/terminal somente quando autorizados e disponíveis
    → validação/redação da resposta
    → interface/chat.html
```

A seleção de uma Skill não concede ferramentas. O servidor registra cada ferramenta apenas quando as permissões da Skill, a tarefa, o contexto do usuário e a configuração da integração permitem. A execução de terminal é opcional: exige repositório GitHub selecionado e validado e `E2B_API_KEY`; ocorre num sandbox temporário separado, sem acesso de saída à internet e sem credenciais do KAZER. Isso não altera nem desliga a internet, a pesquisa ou os conectores do KAZER.

### Pesquisa web

```text
interface / Brain
    → /api/research ou research_web no chat
    → provedores de busca e leitura de fontes no servidor
    → síntese com evidências e citações
```

A pesquisa atual do produto continua nos módulos existentes de Research. A rede bloqueada do sandbox de terminal é uma política local desse executor, não uma mudança na conectividade da aplicação.

### Tarefas em segundo plano

```text
cliente/API → api/workspace.js e api/background-tasks.js
            → Supabase/worker
```

O handler HTTP, o worker e as migrações estão separados porque têm ciclos de execução distintos. O estado efetivo de filas e políticas depende da configuração externa e das migrações aplicadas.

## Contratos de caminho que devem ser preservados

| Caminho | Contrato atual | Verificação antes de mudar |
|---|---|---|
| `api/` | A raiz das funções serverless e das rotas HTTP é definida pela Vercel. Arquivos `api/_*.js` são adaptadores de compatibilidade de uma linha. | `vercel.json`, imports, smoke tests de API e build/deploy isolado. |
| `server/` | Implementações internas separadas por domínio: agente, integrações, pesquisa, segurança, armazenamento, tarefas e uso. | Testes de regressão, imports, análise estática e build de produção. |
| `interface/` | HTML, CSS e JavaScript estáticos servidos pelos rewrites existentes. | Destinos em `vercel.json`, links locais e teste de navegação. |
| `download/` | URLs públicas de manifesto, service worker, ícones, APK e materiais. | Referências em HTML, PWA, `assetlinks.json`, README e headers. |
| `skills/` | Arquivos lidos no servidor; `vercel.json` inclui `skills/**` na função de chat. | Caminhos usados pelo loader, allowlist e teste de empacotamento. |
| `mobile/` | Aplicativo Expo com seu próprio `package.json` e `package-lock.json`. | Build/configuração Expo e caminhos do WebView; não misturar com o lockfile da raiz. |
| `worker/` | Processo e imagem Docker do worker de tarefas. | `Dockerfile`, comando de start, variáveis e contrato da fila. |
| `database/supabase/` | Migrações incrementais identificadas por número. | Ordem, compatibilidade de schema e instruções do README do banco. |

Esses caminhos são parte da arquitetura de publicação. Não mover, renomear, duplicar ou reestruturar em massa sem mapear todas as referências e validar os contratos citados.

## Regras para novas mudanças

1. Coloque cada arquivo no domínio existente mais próximo; crie uma pasta nova somente quando houver uma responsabilidade ou ciclo de build realmente distinto.
2. Preserve nomes e caminhos públicos de API, páginas, downloads, service worker e migrações.
3. Mantenha handlers HTTP finos quando possível e deixe lógica relacionada em módulos privados existentes, sem criar uma segunda implementação da mesma capacidade.
4. Use a raiz para configuração exigida pelas ferramentas; mantenha configuração móvel no diretório `mobile/` e tarefas longas no `worker/`.
5. Novas tabelas ou políticas entram como migração nova e sequencial; não reescreva migrações já aplicadas.
6. Cada mudança de código recebe teste/regressão no diretório `test/` ou `scripts/`; mudanças somente documentais não devem alterar payloads, comportamento ou conectividade.
7. Antes de um movimento de arquivo, faça inventário de imports, URLs, rewrites, manifestos, workflows e deploy; mantenha compatibilidade até validar o caminho novo.

## Leitura recomendada

- [`project-guide.md`](project-guide.md) — setup, variáveis e operação.
- [`testing.md`](testing.md) — verificações locais e CI.
- [`RESEARCH-ARCHITECTURE.md`](RESEARCH-ARCHITECTURE.md) — arquitetura da pesquisa web.
- [`../database/supabase/README.md`](../database/supabase/README.md) — migrações do banco.

## Referências de arquitetura

A decisão de preservar limites claros, agrupar por responsabilidade e evitar camadas/distribuição sem necessidade considera estas referências. São princípios para orientar o projeto, não modelos para copiar sem avaliar o runtime atual:

- [Node.js Best Practices — Project Architecture Practices](https://github.com/goldbergyoni/nodebestpractices): organização por componentes e separação de camadas com limites explícitos.
- [Graphite — How we organize our monorepo to ship fast](https://graphite.com/blog/how-we-organize-our-monorepo-to-ship-fast): módulos composáveis e redução de amplificação de mudanças, carga cognitiva e dependências implícitas; o artigo também ressalta que sua arquitetura é específica ao contexto da empresa.
