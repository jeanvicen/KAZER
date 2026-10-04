# Configuração do Brain

Copie `.env.example` para `.env` somente no ambiente local. Em produção, configure as variáveis privadas no provedor de deploy.

| Variável | Função |
|---|---|
| `GROQ_API_KEY` | Habilita o provider Groq. |
| `DEEPSEEK_API_KEY` | Habilita a rota especializada de código DeepSeek. |
| `HF_TOKEN` | Habilita o provider Hugging Face. |
| `KAZER_PROVIDER_ORDER` | Ordem explícita, por exemplo `groq,huggingface`. |
| `GROQ_MODEL` / `KAZER_TEXT_MODEL` | Modelo de texto principal por provider. |
| `GROQ_CODE_MODEL` / `KAZER_CODE_MODEL` | Modelo opcional para código. |
| `DEEPSEEK_CODE_MODEL` / `DEEPSEEK_CODE_FALLBACK_MODEL` | Modelo principal e fallback da rota DeepSeek para programação. |
| `KAZER_CODE_MAX_OUTPUT_TOKENS` | Teto de saída para código; limitado pelo servidor entre 8.000 e 20.000 tokens. |
| `GROQ_VISION_MODEL` / `KAZER_VISION_MODEL` | Modelo principal para imagens. |
| `*_FALLBACK_MODEL` | Modelo usado após falha real do principal. |
| `HF_CHAT_ENDPOINT` | Endpoint OpenAI-compatible do Hugging Face. |
| `DEEPSEEK_CHAT_ENDPOINT` | Endpoint OpenAI-compatible do DeepSeek; o padrão é `https://api.deepseek.com/chat/completions`. |

Pedidos classificados como `coding` usam somente a ordem **DeepSeek → Qwen Coder via Hugging Face**. Conversas comuns preservam a ordem geral configurada. Se nenhuma dessas credenciais estiver disponível, uma tarefa de código retorna indisponibilidade em vez de trocar silenciosamente para um modelo geral.

A ordem e os nomes de modelo são configuração operacional, não instruções para o modelo. Nunca coloque valores de secrets no repositório, README, frontend ou logs.
