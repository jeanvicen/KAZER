# KAZER Brain

O Brain é um adaptador server-side para providers compatíveis com Chat Completions. O cliente recebe apenas a resposta e a versão pública do Brain; tokens, endpoints, providers e modelos não são expostos.

Antes da chamada, `api/_kazer-context.js` produz um plano interno leve com tipo de tarefa, complexidade, restrições, capacidades necessárias, necessidade de pesquisa, validação e múltiplas etapas. Esse plano orienta a montagem do prompt e a disponibilidade de ferramentas, mas não expõe raciocínio interno ao usuário.

## Roteamento

A ordem efetiva é:

1. `KAZER_PROVIDER_ORDER`, quando configurado;
2. por padrão, `groq,huggingface`;
3. somente providers com credencial disponível entram na fila.

Uma preferência explícita, como a síntese do WebKazer via Groq, vem antes da ordem padrão. A existência de `HF_TOKEN` sozinha não força Hugging Face a passar à frente de um Groq configurado.

Para tarefas classificadas como `coding`, a fila é independente da ordem geral: **DeepSeek → Qwen Coder via Hugging Face**. Se nenhum dos dois estiver configurado, o servidor não troca silenciosamente para um modelo geral. O modo coding usa mais tempo de timeout, temperatura mais baixa, raciocínio habilitado quando o provider suporta e até 20.000 tokens de saída conforme o teto configurado.

## Modelos

Cada provider possui um modelo principal e fallback por tipo de entrada. Para código, o padrão DeepSeek é `deepseek-v4-pro` com `deepseek-flash` como fallback; no Hugging Face, o padrão é `Qwen/Qwen3-Coder-30B-A3B-Instruct`. A classificação distingue conversa, análise, código e visão para permitir configuração específica sem tornar o roteador dependente de dezenas de regras.

## Entendimento de tarefa

A classificação combina intenção de ação e artefatos técnicos, além dos sinais diretos de código. Pedidos de autenticação, sessão, APIs, sistemas e correção de falhas entram no fluxo de engenharia mesmo sem palavras como “código”; perguntas de diagnóstico de repositório sem pedido de alteração permanecem análise. Sinais explícitos de implementação têm precedência sobre termos visuais ambíguos, como “dashboard”. Conjunções que pedem garantir, validar ou preservar um requisito adicional elevam o plano para múltiplas etapas.

## Fallback e retry

O Brain tenta novamente erros transitórios (timeout, rate limit e falhas 5xx). Depois dos retries, avança para o próximo modelo e provider. Resposta vazia ou inválida também é falha, inclusive quando o provider envia `tool_calls: []` sem conteúdo. Downgrade não é silencioso: o log interno registra provider, modelo, tipo de tarefa, motivo e duração, sem tokens ou credenciais.

## Diagnóstico

Os logs usam somente metadados operacionais, incluindo capacidades selecionadas, provider, modelo, tipo de tarefa, motivo da falha e duração. Nunca registrar corpo completo de prompts, API keys, senhas, tokens ou conteúdo privado desnecessário.

## Ferramentas

`research_web` só entra na chamada quando o plano detecta pesquisa, atualidade, fontes ou necessidade de informação externa. Chamadas de ferramentas exigem argumentos objeto, tamanho limitado e, no caso de pesquisa, pergunta válida e profundidade conhecida. Resultados continuam sendo dados não confiáveis.
