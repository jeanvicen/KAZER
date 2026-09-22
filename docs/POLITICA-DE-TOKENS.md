# Política de tokens do KAZER

## Objetivo

O KAZER usa uma cota de tokens para controlar o consumo do chat, do WebKazer, de anexos e de ferramentas conectadas sem apagar saldo não utilizado. A fonte de verdade é o banco de dados no servidor; valores exibidos no navegador são apenas uma representação do saldo oficial.

## Regras do plano Free

| Situação | Regra |
|---|---|
| Primeiro acesso da conta | A conta recebe **1.500 tokens de boas-vindas** uma única vez. |
| Tokens de boas-vindas não utilizados | Permanecem no saldo. Não são zerados pela passagem do tempo. |
| Uso do KAZER | O saldo diminui somente quando uma operação é efetivamente autorizada e reservada no servidor. |
| Virada diária | Às **00:00 UTC**, o usuário recebe **300 tokens adicionais**. A recarga é somada ao saldo existente; ela não substitui nem apaga tokens antigos. |
| Usuário que ficou offline | Ao voltar, o servidor aplica de forma atômica as recargas diárias pendentes, sem duplicar a mesma virada de dia. |
| Saldo zerado | O usuário fica aguardando a próxima recarga diária. Qualquer hora do dia em que o saldo acabar, a conta continua elegível para receber os 300 tokens da próxima virada. |
| Concorrência | O consumo usa bloqueio de linha e atualização atômica para evitar saldo negativo ou duas requisições gastarem os mesmos tokens. |

A recarga diária é implementada como **reset lazy**: não é necessário manter um processo executando exatamente à meia-noite. A primeira consulta de saldo ou tentativa de uso depois da virada calcula as recargas pendentes e atualiza a conta. Isso reduz dependências operacionais e mantém o comportamento correto mesmo quando o usuário não está conectado.

## Como o uso é calculado

O custo do chat não é fixo. Antes de chamar o modelo, o servidor reserva uma quantidade baseada na operação solicitada:

| Operação | Comportamento de cobrança |
|---|---|
| Mensagem simples | Começa em 10 tokens. |
| Histórico longo | Soma uma parcela proporcional ao tamanho do histórico enviado ao modelo. |
| Código, site, aplicativo, bug ou deploy | Soma um peso de tarefa técnica. |
| Imagem ou pedido visual | Soma um peso de análise visual. |
| PDF, DOCX, texto ou outros anexos | Soma um custo por item enviado, respeitando o limite de anexos. |
| MCP ou repositório conectado | Soma um custo por conector solicitado, porque ferramentas externas adicionam contexto e chamadas. |
| WebKazer | A pesquisa começa em 20 tokens e varia conforme o modo, o tamanho da consulta e o número de fontes encontradas. |

A fórmula é uma **reserva de produto**, não uma tentativa de reproduzir exatamente a cobrança interna de um fornecedor. Ela é calculada antes da geração para impedir que uma resposta seja iniciada sem saldo suficiente. O custo real da operação é devolvido na resposta da API e exibido no WebKazer quando a pesquisa termina.

Uma pesquisa no WebKazer e o envio posterior do resultado para o chat são operações diferentes: a pesquisa consome a cota da pesquisa; se o usuário clicar em “Enviar para o KAZER”, a análise no chat terá o custo adicional correspondente à mensagem, ao histórico e ao contexto recebido.

## O que é um token técnico

Em modelos de IA, token é uma unidade de texto que pode representar parte de uma palavra, uma palavra, um espaço ou pontuação. A quantidade não é igual à quantidade de palavras e varia conforme o idioma, a codificação e o modelo. Uma aproximação comum para texto em inglês é quatro caracteres por token, mas ela não é exata para português, imagens, arquivos, ferramentas ou estruturas de mensagens.

Por isso, o KAZER usa o tamanho do histórico como uma das entradas da sua reserva, mas também considera o tipo da tarefa, os anexos e as ferramentas. A documentação oficial da OpenAI distingue tokens de entrada, tokens de saída, tokens de entrada em cache e tokens de raciocínio; também informa que a estrutura das mensagens, ferramentas, imagens e arquivos altera a contagem completa da requisição. Para uma contagem exata antes do envio, a recomendação oficial é utilizar a API de contagem de tokens do endpoint e do modelo correspondente.

Referências técnicas:

- [OpenAI — Understanding and counting tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them)
- [OpenAI — Counting tokens](https://developers.openai.com/api/docs/guides/token-counting)

## Implementação no KAZER

A migração `014_daily_token_policy.sql` adiciona ao catálogo e ao estado de cada conta os valores da concessão inicial, da recarga diária, da data da primeira concessão e da quantidade de recargas aplicadas. Ela também altera a função de reset para somar tokens e recalcula a próxima virada em 00:00 UTC.

As RPCs `get_my_usage` e `consume_kazer_usage` continuam protegidas para usuários autenticados. A resposta de uso inclui `waiting_for_daily_tokens`, permitindo que a interface diferencie saldo baixo de uma conta que está aguardando a próxima recarga. A API do chat e a API do WebKazer retornam erro 402 sem iniciar a operação quando não há saldo suficiente.

No frontend, o saldo passou a ser descrito como tokens, o aviso de limite informa a próxima recarga diária e a pesquisa WebKazer mostra o custo da pesquisa concluída. Os anexos continuam tendo um limite separado por janela, pois são uma restrição operacional diferente da cota de tokens.

## Aplicação e validação

A migração deve ser executada no Supabase de desenvolvimento primeiro e depois no ambiente correto de produção, sempre depois das migrações 001 a 013. O fluxo recomendado é testar com duas contas: uma conta nova para confirmar 1.500 tokens, uma mensagem para confirmar o desconto, saldo remanescente para confirmar que não foi perdido, uma conta com saldo zero para confirmar o bloqueio 402 e uma virada de dia simulada ou controlada para confirmar a soma de 300 tokens.

A aplicação da migração não deve ser considerada suficiente apenas porque o SQL foi aceito. Também é necessário confirmar pelo endpoint autenticado que o saldo pertence ao usuário correto, que duas requisições simultâneas não geram saldo negativo, que a pesquisa web desconta tokens e que a interface atualiza o saldo depois do chat e da pesquisa.
