# KAZER com Groq grátis: como ele aguenta mais gente sem travar

O KAZ 1.1 roda **só na Groq**. A Groq dá um plano grátis, mas com limites
**por modelo** e **por organização** (a conta inteira, não por chave):

| Modelo (plano grátis, valores aproximados) | Pedidos/dia | Tokens/minuto | Tokens/dia |
|---|---|---|---|
| openai/gpt-oss-120b | 1.000 | 8.000 | 200.000 |
| llama-3.1-8b-instant | 14.400 | 6.000 | 500.000 |
| meta-llama/llama-4-scout | 1.000 | 30.000 | — |

Os números exatos da conta aparecem no painel da Groq (Settings → Limits) e o
KAZER lê os valores reais nos cabeçalhos de cada resposta. Então se a tabela
acima mudar, ele se ajusta sozinho.

O "O KAZER está com muita demanda agora" era o erro 429 da Groq: algum desses
limites estourou. Abaixo está o que foi feito para isso acontecer o mínimo
possível, sem nenhuma outra IA e sem gastar nada.

## 1. Governador de limites (`kazer/brain/groq_limits.py`)

Inspirado no *cooldown* do roteador do [LiteLLM](https://github.com/BerriAI/litellm),
feito aqui sem dependência nova.

- Toda resposta da Groq traz cabeçalhos `x-ratelimit-*` (quanto sobra no minuto,
  quanto sobra no dia, quando renova). O KAZER guarda isso por modelo.
- Modelo que respondeu 429, ou que zerou a cota do dia, entra em "descanso" até
  renovar. As próximas mensagens **nem tentam** esse modelo e vão direto para
  um livre. Antes, cada mensagem batia no modelo cheio, levava 429 e só depois
  tentava o próximo.
- **"Request too large"**: quando o pedido inteiro é maior que o limite por minuto
  de um modelo, a Groq recusa na hora (código 413). Antes isso virava erro
  para a pessoa. Agora o KAZER aprende o limite real daquele modelo e passa para
  outro (ou tenta o mesmo com uma resposta menor).
- **Tamanho da resposta sob medida**: o teto de saída de cada chamada é ajustado
  para caber no limite por minuto do modelo. Resposta longa (um jogo inteiro,
  por exemplo) continua sozinha na chamada seguinte, sem corte para a pessoa.
- Se todos os modelos estão sem cota do dia, o KAZER avisa na hora em vez de
  prender a pessoa esperando.

Cada instância do servidor (a Vercel sobe várias) lembra o que viu. Não guarda
texto, chave nem conteúdo, só números.

## 2. Distribuir a carga entre os modelos

Os limites são separados por modelo, então usar vários modelos multiplica a
capacidade da conta. Isso segue a ideia do [RouteLLM](https://github.com/lm-sys/RouteLLM):
modelo forte para o que é difícil, modelo leve para o resto.

- **Conversa leve** ("oi", "valeu", perguntas curtas) começa no Llama 4 Scout e
  no Kimi K2, que têm cota por minuto maior.
- **Código, contas, arquivos e pesquisa** começam no gpt-oss-120b (o mais forte).
- **Título da conversa** (tarefa de bastidor) usa o llama-3.1-8b-instant, que tem
  14.400 pedidos por dia. Antes, cada conversa nova gastava um pedido do 120b só
  para gerar o nome.
- A cadeia tem 7 modelos. Se um some ou lota, o próximo responde.

## 3. Cache de prompt da Groq

A Groq guarda em cache o **começo repetido** do prompt (no gpt-oss-120b, entre
outros), e **tokens em cache não contam no limite por minuto**
([docs da Groq](https://console.groq.com/docs/prompt-caching)). Por isso o prompt
do sistema agora começa pela parte fixa, igual para todo mundo (regras, tom,
pesquisa). O que muda (data, pedido, dados da pessoa) vem no fim. Com muita gente
usando, esse começo fica quase sempre em cache.

## 4. Mandar menos tokens por mensagem

- Só vão as ferramentas que o pedido usa: clima só quando fala de clima, GitHub
  só quando fala de código etc. Antes iam as 13 sempre.
- Só vão as partes do manual que combinam (PDF, slides, Godot, ensino).
- **Compressão de páginas** (`focus_text` em `kazer/chat/web_tools.py`): a ideia do
  [LLMLingua](https://github.com/microsoft/LLMLingua), feita sem modelo extra.
  Página longa vira só os trechos que têm as palavras do pedido, mais o começo
  da página. Uma página de 5 mil caracteres pode virar 200 caracteres com a
  resposta dentro.
- Histórico enviado: até 48 mil caracteres. Resultados antigos de pesquisa são
  resumidos.

Uma mensagem simples caiu de cerca de 11,5 mil para 5 mil caracteres enviados.

## 5. Na tela: tentar de novo sozinho

Se mesmo assim a Groq disser que está cheia, a pessoa não fica com um erro
parado. Aparece "Muita gente usando agora. Tento de novo em 5 s…" e o KAZER
tenta sozinho (5 s, 12 s, 25 s), já pulando os modelos lotados.

## Por que não foi colocada nenhuma biblioteca dessas no repositório

LiteLLM, RouteLLM, GPTCache e LLMLingua são ótimas, mas pesadas. RouteLLM e
LLMLingua precisam rodar modelos próprios, e LiteLLM traz centenas de
dependências. Na Vercel isso deixaria cada função mais lenta para ligar e mais
cara. Por isso a ideia de cada uma foi feita em poucas linhas, dentro do KAZER,
com testes (`tests/test_groq.py`, `tests/test_web_tools.py`).

## A conta honesta: quantas pessoas cabem no grátis

Somando os modelos de chat, o plano grátis dá na casa de **20 mil pedidos por
dia** para a conta inteira. Uma mensagem com pesquisa gasta de 2 a 5 pedidos (a
resposta e cada rodada de busca). Na prática:

- **Centenas a poucos milhares de pessoas por dia**: dá, com tudo acima.
- **Milhões de pessoas**: nenhum código faz o plano grátis da Groq aguentar,
  porque é um teto da conta. Criar várias contas para somar limites é contra as
  regras de uso da Groq e pode derrubar tudo.

O caminho para escalar continua sendo **só Groq, mesmo modelo, mesmo KAZ 1.1**:
quando o KAZER tiver assinantes (os planos e o checkout já estão prontos), parte
desse dinheiro paga o plano Developer da Groq, que tem limites muito maiores.
Não precisa mudar nada no código: o governador lê os novos limites nos
cabeçalhos e passa a usar respostas maiores e mais pedidos sozinho.

Até lá, os limites de uso por conta (o "Uso e plano" de cada pessoa) seguram que
poucas pessoas gastem a cota do dia de todo mundo.
