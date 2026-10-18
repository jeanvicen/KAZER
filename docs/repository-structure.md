# Mapa do repositório KAZER

Este mapa descreve a branch `main` observada em **18 de outubro de 2026**. A organização atual separa o produto por responsabilidade e por ambiente de execução. Ela não é o mesmo monorepo do `KAZER.V1`: a interface web atual, as funções Vercel e as URLs públicas do KAZER dependem de caminhos já publicados.

## Estrutura

```text
KAZER/
├── .github/                 CI, Dependabot e CODEOWNERS
├── .well-known/             Associação pública do app Android
├── .agents/                 Recursos de desenvolvimento para agentes
├── api/                     Rotas HTTP serverless da Vercel (11 handlers)
│   ├── chat.js              Chat
│   ├── research.js          Pesquisa web
│   ├── workspace.js         Tarefas e conectores
│   ├── background-tasks.js  Entrada das tarefas de longa duração
│   └── ...                  GitHub, Drive, uso, retenção e notificações
├── server/                  Implementações backend por domínio
│   ├── agent/               Brain, Skills, contexto e terminal isolado
│   ├── integrations/        GitHub, Drive, MCP e plugins
│   ├── research/            Busca, browser e evidências
│   ├── security/            Segurança de requests e SSRF
│   ├── storage/             Acesso de dados/Supabase
│   ├── tasks/               Tarefas e contexto do worker
│   └── usage/               Limites e uso
├── database/supabase/       Migrações SQL numeradas e guia do banco
├── docs/                    Arquitetura, configuração, testes, políticas e auditorias
│   ├── audits/              Auditorias e relatórios históricos
│   └── assets/              Imagens usadas pela documentação
├── download/                Arquivos públicos, manifesto, service worker e distribuição
│   ├── android/             APK, documentação e projeto de publicação Android
│   ├── assets/              Marcas e artes de distribuição
│   ├── icons/               Ícones usados pelo PWA e pelas plataformas
│   ├── ios/                 Documentação de distribuição iOS
│   └── pwa/                 Documentação do PWA
├── interface/               Páginas estáticas e scripts/CSS do navegador
│   └── documentos/          Central de documentos
├── mobile/                  App Expo/WebView independente da interface estática
├── planos/                  Pesquisa e planejamento de produto
├── scripts/                 Verificações, testes de integração e manutenção
├── skills/                  Agent Skills do Brain
│   └── kazer-*/             SKILL.md, referências e scripts de cada Skill
├── test/                    Testes automatizados de regressão e contrato
├── worker/                  Worker, inicialização e Dockerfile
├── Control/                 Configuração e instruções de avisos globais
├── .env.example             Nomes de variáveis; somente placeholders
├── package.json             Dependências e scripts Node da raiz
├── package-lock.json        Lockfile correspondente ao pacote da raiz
└── vercel.json              Rewrites, headers, cron e arquivos da função de chat
```

A lista é intencionalmente resumida: para descobrir os arquivos concretos, use a busca do GitHub ou a árvore da branch. Não crie cópias de arquivos existentes apenas para preencher este mapa.

## Onde colocar cada tipo de mudança

| Se você está adicionando... | Coloque em... | Cuidados |
|---|---|---|
| Uma tela/página estática | `interface/` | Não renomeie páginas existentes sem atualizar `vercel.json`, navegação e links. |
| Um endpoint HTTP | `api/<rota>.js` | Preserve autenticação, validação, limites, timeouts e contrato JSON. |
| Lógica interna de backend | `server/<domínio>/` | Mantenha uma única implementação; `api/` deve conter somente handlers de rota Vercel. |
| Pesquisa, conectores ou Skills | `server/research/`, `server/integrations/`, `server/agent/` e `skills/` | Mantenha allowlists, validação server-side e bundle de Skills da Vercel sincronizados. |
| Migração de schema | Novo arquivo numerado em `database/supabase/` | Nunca renumere/regrave migração já aplicada; documente pré-requisitos e rollback. |
| Tarefa longa | `worker/` mais o contrato existente em `api/`/banco | Não assuma que a fila ou migração existe em produção sem confirmação. |
| Código do app móvel | `mobile/` | Use o `package.json` e lockfile móveis; não misture dependências com a raiz. |
| Teste | `test/` ou `scripts/` | Prefira teste determinístico; integração real exige credenciais e aprovação explícita. |
| Guia, arquitetura ou política | `docs/` | Atualize o índice em `docs/README.md` e os links afetados. |
| Planejamento ou pesquisa de produto | `planos/` | Preserve os documentos históricos; adicione versões em vez de sobrescrevê-los. |
| Arquivo servido publicamente | `download/` | Trate a URL como contrato público usado por manifestos, app e links existentes. |

## Arquivos de raiz que são intencionais

`package.json`, `package-lock.json`, `.nvmrc`, `.env.example` e `vercel.json` ficam na raiz porque as ferramentas e o deploy da aplicação atual os leem dali. `.github/`, `.well-known/`, `.agents/` e os arquivos de licença, segurança e contribuição também têm consumidores próprios. Não os mova para uma pasta `config/` sem antes alterar e testar os consumidores. `api/` é o diretório padrão de rotas serverless deste deploy da Vercel; toda lógica compartilhada fica em `server/`. Para removê-lo de verdade, seria necessário trocar o modelo de build/deploy e validar todos os arquivos estáticos e rotas.

`mobile/` possui um pacote Expo e lockfile próprios; não é um workspace npm configurado no pacote raiz. Essa separação deve ser mantida até existir uma decisão e um build de monorepo testados.

## Antes de reorganizar caminhos

- Mapeie `require`/`import`, links Markdown, URLs na interface, rewrites, headers, service worker e referências no app móvel.
- Confira `vercel.json`, workflows em `.github/`, Dockerfile do worker e scripts de build/teste.
- Faça a mudança em etapas pequenas, sem apagar cópias de segurança necessárias à compatibilidade.
- Execute `npm ci --ignore-scripts`, `npm test`, `npm run check` e `npm run integration:test`; valide também os comandos móveis quando `mobile/` for afetado.
- Confirme que os arquivos movidos existem no bundle da Vercel e que páginas, pesquisa, conectividade, PWA e downloads mantêm os mesmos caminhos.
- Revise o diff inteiro antes de integrar. Um teste verde não prova sozinho que o deploy, Supabase ou provedores externos estão configurados.
