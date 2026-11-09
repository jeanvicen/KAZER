# Changelog

Mudanças que importam para quem usa e para quem opera o KAZER.

## 2026-11 — Conversa por voz como com uma pessoa

### Novo
- **Interromper falando:** enquanto o KAZER fala, ele continua ouvindo. Se você
  falar por cima, ele para na hora e responde ao que você disse agora. Um filtro
  anti-eco ignora o microfone captando a própria voz dele; "para", "espera" e
  "calma" também interrompem.
- **Timbre "assistente":** a voz masculina ficou mais grave e serena, com um leve
  ar de sala; a síntese tem mais variação de entonação (menos "robô lendo").
- **Jeito de falar humano:** no modo voz o KAZER fala como numa conversa — frases
  curtas, português falado, sem "Claro!", "Ótima pergunta" nem "Espero ter
  ajudado", sem repetir aberturas, e pede pra repetir quando não entende.

## 2026-11 — Voz masculina open source dentro do KAZER

### Mudou
- **A conversa por voz fala com a voz do próprio KAZER:** Piper (open source),
  voz masculina em português do Brasil ("cadu"), gerada no servidor do KAZER, sem
  chave e sem custo por uso. A voz do aparelho (Google) saiu da conversa por voz.
- A legenda mostra o que você disse (cinza) e o que o KAZER está falando (branco).
- Saiu o seletor de vozes do aparelho; vozes pagas só se configuradas de propósito.


### Novo
- **Voz realista:** com `ELEVENLABS_API_KEY` ou `OPENAI_API_KEY` configurada, a
  conversa por voz fala com voz neural gerada no servidor (`/api/voice/tts`),
  frase a frase, e a esfera segue o volume real da voz. Sem chave, voz do aparelho.
- **Tela de voz como a do ChatGPT:** esfera grande, legenda e uma barra de botões
  redondos: microfone (desligar/ligar), legenda, voz, digitar e o X vermelho.

### Mudou
- **Artefatos só quando a pessoa pede uma entrega** (site, arquivo, PDF, slides,
  planilha, "me manda o arquivo", "refaz"...). Pergunta de como fazer ou conversa
  comum não cria nada, mesmo com exemplos de código na resposta.
- Saiu a lista "peças na sua Biblioteca" embaixo das respostas; as entregas
  pedidas continuam em Artefatos, na gaveta.

## 2026-11 — Visual refinado (estilo buscador de respostas)

### Melhor
- **Uma fonte só na interface (Inter)**, servida pelo próprio site; o gótico
  fica só no nome KAZER. Saudação, títulos e textos ficaram mais calmos e
  legíveis.
- **Tela vazia como um buscador de respostas:** no computador o campo de
  escrever fica no centro, com a saudação acima e sugestões de começo abaixo
  ("Planejar minha semana", "Explicar um assunto", "Criar um site", "Pesquisar
  na web"). No celular as sugestões ficam acima do campo. Tocar só preenche.
- Composer, mensagens, tabelas, blocos de código, gaveta e telas de entrada com
  medidas mais precisas; "Nova conversa" neutro (o ouro fica para enviar); no
  tema claro o campo é branco com borda fina.
- Rótulos pequenos da gaveta e o atalho "Ctrl K" agora passam no contraste AA.

## 2026-11 — Conversa por voz

### Novo
- **Conversa por voz:** com o campo vazio, o botão dourado de onda abre a tela
  de voz (Ouvindo · Pensando · Falando). O KAZER responde pelo mesmo chat (a
  conversa fica salva normalmente) e fala a resposta frase a frase, sem ler
  markdown, código, links nem citações. Tocar no centro interrompe.
- Com texto ou anexo no campo, o botão volta a ser a seta de enviar.
- **Voice gateway opcional e auto-hospedado** (faster-whisper + Kokoro, código
  e pesos com licenças permissivas), com token curto de uso único, limites por
  conta e por instância, `/healthz`, `/readyz`, `/metrics`. Sem ele, a voz usa o
  reconhecimento e a síntese do navegador. Docs em `docs/voice/`.
- Pesquisa de 100 repositórios open source de voz verificados
  (`docs/voice/RESEARCH.md`).

## 2026-11 — Fotos na explicação, vidro, voz e uso que abre

### Corrigido
- **Uso e plano** abre de novo para quem já usou o app (a data de renovação vinha
  em texto do Supabase e travava a tela) e agora mostra quanto foi usado, quanto
  falta e quando renova.
- A galeria de fotos rola com o dedo (estava cortada na borda); arrastar não
  abre a foto.

### Melhor
- O KAZER só pesquisa quando precisa: tutoriais, criação, conceitos e conversa
  não vão mais para a web; na dúvida, um modelo leve decide e, se ele não
  responder, o KAZER responde com o que sabe.
- Fotos de referência no meio da explicação, como no ChatGPT: ao explicar algo
  visual, o KAZER busca só as fotos e mostra cada uma junto do parágrafo certo.
- Vidro líquido (estilo iOS) no botão de enviar, nos botões do campo e na
  conversa aberta do histórico, no lugar da faixa dourada.
- Ditado como o do Claude: o texto aparece ao vivo em até 3 linhas, a onda
  reage à voz e há botões para cancelar, parar e revisar, ou enviar direto.
- "Pensando · N s" com o tempo de verdade, prévia da ideia do momento e, no fim,
  "Pensou por N s" com as etapas do raciocínio legíveis.

## 2026-11 — Pesquisa com cara de ChatGPT

### Melhor
- A pesquisa aparece como linhas discretas no lugar da linha do tempo com
  bolinhas: "Planejando a pesquisa", "Pesquisando na web", "Pesquisando em 6
  sites" (com os sites ao lado), depois "Pesquisou 6 sites" e "Pensando". Tocar
  na linha abre os sites visitados, os números reais e cada busca feita.
- "Pensou por N s" no lugar de "Raciocínio" quando o modelo pensa antes de
  responder (tempo medido de verdade).

### Novo
- Botão **Pular** enquanto a pesquisa roda: o KAZER para de pesquisar e responde
  com o que já encontrou, avisando o que não deu para verificar.

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
