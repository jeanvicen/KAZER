# KAZER

<p align="center">
  <strong>Seu espaço pessoal.</strong><br/>
  Conversar · pesquisar · desenhar · organizar · cobrar.
</p>

<p align="center">
  <a href="https://kazer.vercel.app"><img src="https://img.shields.io/badge/produto-kazer.vercel.app-d6b25e?style=flat-square&labelColor=050505" alt="Produto"></a>
  <a href="#status"><img src="https://img.shields.io/badge/status-em%20desenvolvimento-6f42c1?style=flat-square&labelColor=050505" alt="Status"></a>
  <a href="#desenvolvimento"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&labelColor=050505" alt="Node"></a>
  <a href="#publicação"><img src="https://img.shields.io/badge/deploy-vercel-000000?style=flat-square&labelColor=050505" alt="Vercel"></a>
</p>

<p align="center">
  <a href="https://kazer.vercel.app">Abrir o KAZER</a>
  ·
  <a href="planos/README.md">Planos e ferramentas</a>
  ·
  <a href="docs/README.md">Documentação</a>
</p>

---

O KAZER é o espaço web/PWA de Jean V. / KLYPZA para explicar, escrever, organizar ideias, analisar conteúdo e transformar pedidos em próximos passos — com pesquisa, workspace e integrações no mesmo lugar.

A interface é **Obsidian & Gold**. O navegador nunca é fonte de verdade: autenticação, tokens, autorização e limites são revalidados no servidor.

O projeto é **proprietário**. Consulte [`LICENSE.md`](LICENSE.md), [`SECURITY.md`](SECURITY.md) e os documentos jurídicos antes de publicar ou compartilhar qualquer parte do código.

## O que já está no ar

| Recurso | Para o usuário |
|---|---|
| **Conversa** | Chat com Brain (Groq / Hugging Face), Markdown e continuidade da sessão. |
| **Anexos** | JPEG, PNG, WebP, GIF, PDF, DOCX e texto — allowlist e limite no servidor. |
| **WebKazer** | Pesquisa em várias fontes, leitura de páginas e síntese com citações. |
| **Workspace** | Tarefas, progresso, custo e repositórios no painel do raio. |
| **GitHub** | OAuth, lista de repos e contexto do pedido a partir do código. |
| **Drive + MCP** | Google Drive e plugins com segredos cifrados no backend. |
| **PWA** | Instala na tela inicial. Sem loja, sem taxa da Apple ou do Google. |
| **Kazer Pro** | Chamada visual pronta. A compra ainda está em preparação. |

Nada disso será apagado, trocado ou reescrito por moda. Melhoria entra **ao lado** do que já funciona.

## O que entra a seguir (custo zero de GPU)

Pesquisa de mercado 2026 (ChatGPT, Claude, Perplexity, Canva Magic Studio, Gamma, Recraft, Notion) mostra o que as pessoas pagam — e o que o KAZER pode entregar **sem aluguel de GPU**:

| Ferramenta | Por que importa | Como nasce barato |
|---|---|---|
| **Ateliê SVG** | Recraft cobra pelo vetor nativo. Canva Pro ~US$ 15. | `kazer-svg` já existe no Brain. O browser exporta o arquivo. |
| **Brand Kit** | MEI e infoprodutor pagam designer só por paleta + marca. | Tokens CSS + selo + peça 1:1 / 9:16 / 16:9. |
| **Estúdio social** | Instagram e YouTube são o funil grátis do Brasil. | SVG editorial no cliente. |
| **Voz PT · JP** | ElevenLabs cobra crédito. O titular vive no Brasil e no Japão. | Web Speech API do próprio navegador. |
| **Proposta MEI** | O cliente fecha no WhatsApp. Quem manda PDF ganha. | Template + chat. |
| **PIX do Pro** | Cartão gringo mata conversão. | Mercado Pago / Abacate Pay: cadastro grátis, taxa só na venda. |
| **BYOK** | Token caro some do seu bolso. | A chave é do usuário. A assinatura paga a casa. |

O mapa completo está em [`planos/`](planos/README.md). A pasta estava vazia: agora é o lugar dos planos. **Nenhum arquivo de produto foi removido.**

## Ganhar dinheiro sem gastar para começar

Infra de graça enquanto couber nos planos livres:

`Vercel Hobby` · `Supabase Free` · `Groq` · `Hugging Face` · `GitHub` · `Web Speech` · `SVG no cliente`

A conta do Pro, quando a compra sair do “em preparação”:

| Assinantes | Preço | Bruto / mês | Infra |
|---:|---:|---:|---|
| 40 | R$ 29 | R$ 1.160 | R$ 0 |
| 100 | R$ 29 | R$ 2.900 | R$ 0 |
| 40 | R$ 79 | R$ 3.160 | R$ 0 |

Detalhe, PIX, afiliados e infoproduto: [`planos/MONETIZACAO-ZERO.md`](planos/MONETIZACAO-ZERO.md).

## Como o KAZER funciona

O KAZER combina interface estática/PWA em `interface/`, funções serverless em `api/` e Supabase com RLS.

```text
login → sessão Supabase → chat
                         ├ POST /api/chat      (Brain, anexos, MCP)
                         ├ POST /api/research  (WebKazer)
                         └ GET  /api/usage     (limites)
```

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

Use Node.js 20 ou superior. A versão mínima está em [`.nvmrc`](.nvmrc). Nunca faça commit do `.env` nem de credenciais privadas.

## Navegação

| Preciso de… | Consulte |
|---|---|
| Entender a arquitetura, APIs, limites e integrações | [Guia detalhado do projeto](docs/project-guide.md) |
| Encontrar toda a documentação | [Índice de documentação](docs/README.md) |
| Ver o que o KAZER vai ter (sem mexer no código) | [Planos](planos/README.md) |
| Configurar providers e variáveis | [Configuração do Brain](docs/configuration.md) e [`.env.example`](.env.example) |
| Executar testes e regressões | [Guia de testes](docs/testing.md) |
| Conhecer o banco e as migrações | [`database/supabase/README.md`](database/supabase/README.md) |
| Publicar na Vercel | [`vercel.json`](vercel.json) e [checklist de publicação](docs/CHECKLIST-DE-PUBLICACAO.md) |
| Revisar segurança | [`SECURITY.md`](SECURITY.md) |
| Consultar auditorias e pesquisas anteriores | [`docs/audits/`](docs/audits/) |
| Desenvolver o app Expo/EAS | [`mobile/README.md`](mobile/README.md) |
| Sistema visual Obsidian & Gold | [Sistema visual](docs/visual-system.md) |

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
| `planos/` | Roadmap, ateliê, catálogo de ferramentas e monetização sem gasto. |
| `.github/` | CI, Dependabot e CODEOWNERS. |

## Desenvolvimento

Para revisar somente as páginas estáticas, execute `python3 -m http.server 4173` na raiz e abra `http://localhost:4173/interface/login.html`. Para o fluxo completo com funções serverless, use `npx vercel@latest dev` com um ambiente autorizado.

O GitHub Actions executa automaticamente `npm test`, `npm run check` e `npm run security:audit -- --audit-level=high` em pushes para `main` e pull requests. Falhas devem ser corrigidas antes do deploy.

## Publicação

O projeto está preparado para a Vercel a partir da raiz. Configure as variáveis privadas no ambiente de deploy, aplique as migrações Supabase na ordem e mantenha `RETENTION_DELETE_ENABLED=false` até existir um procedimento operacional revisado.

## Status

O KAZER está em desenvolvimento. Autenticação, chat, pesquisa, uso, anexos, PWA, retenção, MCPs, GitHub e workspace estão implementados na branch atual. A compra Kazer Pro ainda está em preparação.

**Regra da casa:** melhorar sempre. Nunca destruir, nunca trocar o que já funciona, nunca apagar `interface/chat.html` nem os handlers de `api/`.

## Propriedade e contribuições

Todos os direitos são reservados. Pull requests, forks, redistribuição, uso comercial ou reutilização da identidade do KAZER exigem autorização escrita do titular. Para o fluxo autorizado, consulte [`CONTRIBUTING.md`](CONTRIBUTING.md). Relatos de segurança devem seguir [`SECURITY.md`](SECURITY.md).

## Licença

Este projeto não concede licença open source ou comercial. Consulte [`LICENSE.md`](LICENSE.md) para o texto integral.
