# Changelog

Mudanças que importam para quem usa e para quem opera o KAZER.

## 2026-11 — Visual novo: obsidiana e ouro champanhe

### Novo
- Logo novo (o alien) em todo lugar: cabeçalhos, favicon, ícones do app
  instalável, intro animada e capa dos documentos gerados.
- Mascote em pixel art: o KAZER aparece programando na tela da cena de
  entrada, no pôster e no boneco da estante, na tela sem internet, no
  carregador e nas boas-vindas do KZ Code.
- Entrada no estilo "e-mail primeiro" ("Entrar com e-mail" e "Criar conta"),
  com cartão no computador e as cenas em pixel mantidas.

### Melhor
- Sistema de cores com tokens semânticos (`docs/brand.md`): preto obsidiana como
  base, ouro champanhe só na ação principal, na seleção, no foco e em detalhes
  da marca. Tema claro com texto em bronze, legível (AA).
- KZ Code e plano Ultra entram na mesma família de cor (saem o laranja e o
  roxo); avisos ganham uma cor própria, separada do ouro e do vermelho de erro.
- Rótulo "E-mail" visível em todos os tamanhos de tela.
- Configurações: a linha "Aparência" mostra o tema novo assim que ele muda.

## 2026-11 — Modelos premium e pesquisa nova

### Novo
- Planos **Pro (R$ 1.599)** e **Ultra (R$ 10.000)** com Claude (Haiku, Sonnet,
  Opus; Fable no Ultra), GPT e Kimi, por crédito mensal medido em cada
  resposta. Divisão de cada assinatura em `docs/NEGOCIO.md`.
- Webhook do Stripe: pagamento liga o plano, renovação estende, cancelamento
  volta ao grátis.
- Seletor de modelos na tela, com selo do plano e porcentagem do crédito usada.
- Fotos reais (Wikimedia Commons e Openverse) no topo das respostas sobre
  assuntos visuais.
- Rota `/api/diagnostics/search` para ver quais fontes de busca respondem do
  servidor.

### Melhor
- Pesquisa feita **antes** do modelo: o KAZER busca, lê as melhores páginas e o
  modelo só escreve. Isso acaba com os erros de chamada de ferramenta da Groq.
- Novas fontes de busca que funcionam de servidor (feed do Bing, Wikipédia em
  inglês), cache de 10 minutos e resultados ordenados por relevância.
- Decisão de pesquisar: casos claros por regra; casos duvidosos decididos por um
  modelo leve.
- Governador de limites da Groq: pula modelos sem cota, ajusta o tamanho da
  resposta ao limite por minuto e aproveita o cache de prompt.

### Removido
- Pesquisa profunda: a pesquisa normal já busca sozinha.

### Corrigido
- Estilos do microfone e do botão enviar eram bloqueados pela CSP.
- Respostas vazias quando o raciocínio ocupava todo o espaço da resposta.
