# KAZER Brain

O Brain é um adaptador server-side para providers compatíveis com Chat Completions. O cliente recebe apenas a resposta e a versão pública do Brain; tokens, endpoints, providers e modelos não são expostos.

## Roteamento

A ordem efetiva é:

1. `KAZER_PROVIDER_ORDER`, quando configurado;
2. por padrão, `groq,huggingface`;
3. somente providers com credencial disponível entram na fila.

Uma preferência explícita, como a síntese do WebKazer via Groq, vem antes da ordem padrão. A existência de `HF_TOKEN` sozinha não força Hugging Face a passar à frente de um Groq configurado.

## Modelos

Cada provider possui um modelo principal e fallback por tipo de entrada. A classificação distingue conversa, análise, código e visão para permitir configuração específica sem tornar o roteador dependente de dezenas de regras.

## Fallback e retry

O Brain tenta novamente erros transitórios (timeout, rate limit e falhas 5xx). Depois dos retries, avança para o próximo modelo e provider. Resposta vazia ou inválida também é falha. Downgrade não é silencioso: o log interno registra provider, modelo, tipo de tarefa, motivo e duração, sem tokens ou credenciais.

## Diagnóstico

Os logs usam somente metadados operacionais. Nunca registrar corpo completo de prompts, API keys, senhas, tokens ou conteúdo privado desnecessário.
