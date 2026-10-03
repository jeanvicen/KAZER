# KAZER

> Espaço web/PWA de conversa com inteligência artificial para explicar, escrever, organizar ideias, analisar conteúdo e transformar pedidos em próximos passos.

[![Status](https://img.shields.io/badge/status-em%20desenvolvimento-6f42c1)](#status) [![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](#desenvolvimento) [![Deploy](https://img.shields.io/badge/deploy-vercel-000000)](#publicação)

## Como o KAZER funciona

O KAZER combina uma interface estática/PWA em `interface/`, funções serverless em `api/` e Supabase com RLS. O navegador não é fonte de verdade para autenticação, tokens, autorização ou limites: essas responsabilidades são revalidadas no servidor.

O projeto é proprietário. Consulte [`LICENSE.md`](LICENSE.md), [`SECURITY.md`](SECURITY.md) e os documentos jurídicos antes de publicar ou compartilhar qualquer parte do código.

## Comece rapidamente

```bash
git clone https://github.com/jeanvicen/KAZER.git
cd KAZER
npm ci --ignore-scripts
cp .env.example .env
npm test
npm run check
npm run security:audit -- --audit-level=high
```

Use Node.js 20 ou superior. A versão mínima está registrada em [`.nvmrc`](.nvmrc). Nunca faça commit do `.env` nem de credenciais privadas.

## Navegação

| Preciso de… | Consulte |
|---|---|
| Entender a arquitetura, APIs, limites e integrações | [Guia detalhado do projeto](docs/project-guide.md) |
| Encontrar toda a documentação | [Índice de documentação](docs/README.md) |
| Configurar providers e variáveis | [Configuração do Brain](docs/configuration.md) e [`.env.example`](.env.example) |
| Executar testes e regressões | [Guia de testes](docs/testing.md) |
| Conhecer o banco e as migrações | [`database/supabase/README.md`](database/supabase/README.md) |
| Publicar na Vercel | [`vercel.json`](vercel.json) e [checklist de publicação](docs/CHECKLIST-DE-PUBLICACAO.md) |
| Revisar segurança | [`SECURITY.md`](SECURITY.md) |
| Consultar auditorias e pesquisas anteriores | [`docs/audits/`](docs/audits/) |
| Desenvolver o app Expo/EAS | [`mobile/README.md`](mobile/README.md) |

## Estrutura principal

| Diretório | Responsabilidade |
|---|---|
| `interface/` | Login, chat, documentos públicos e scripts do cliente. |
| `api/` | Handlers serverless, autenticação, Brain, pesquisa e integrações. |
| `database/supabase/` | Migrações SQL incrementais e documentação do banco. |
| `download/` | Manifesto, service worker e distribuição PWA. |
| `mobile/` | Aplicativo Expo/EAS que abre a experiência publicada. |
| `scripts/` | Verificações de segurança, regressões e smoke tests. |
| `docs/` | Guias técnicos, operação, governança e relatórios históricos. |
| `.github/` | CI, Dependabot e CODEOWNERS. |

## Desenvolvimento

Para revisar somente as páginas estáticas, execute `python3 -m http.server 4173` na raiz e abra `http://localhost:4173/interface/login.html`. Para o fluxo completo com funções serverless, use `npx vercel@latest dev` com um ambiente autorizado.

O GitHub Actions executa automaticamente `npm test`, `npm run check` e `npm run security:audit -- --audit-level=high` em pushes para `main` e pull requests. Falhas devem ser corrigidas antes do deploy.

## Publicação

O projeto está preparado para a Vercel a partir da raiz. Configure as variáveis privadas no ambiente de deploy, aplique as migrações Supabase na ordem e mantenha `RETENTION_DELETE_ENABLED=false` até existir um procedimento operacional revisado.

## Status

O KAZER está em desenvolvimento. Autenticação, chat, pesquisa, uso, anexos, PWA, retenção, MCPs, GitHub e workspace estão implementados na branch atual. A compra Kazer Pro ainda está em preparação.

## Propriedade e contribuições

Todos os direitos são reservados. Pull requests, forks, redistribuição, uso comercial ou reutilização da identidade do KAZER exigem autorização escrita do titular. Para o fluxo autorizado, consulte [`CONTRIBUTING.md`](CONTRIBUTING.md). Relatos de segurança devem seguir [`SECURITY.md`](SECURITY.md).

## Licença

Este projeto não concede licença open source ou comercial. Consulte [`LICENSE.md`](LICENSE.md) para o texto integral.
