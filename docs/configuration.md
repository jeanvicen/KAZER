# Configuração do Brain

Copie `.env.example` para `.env` somente no ambiente local. Em produção, configure as variáveis privadas no provedor de deploy.

| Variável | Função |
|---|---|
| `GROQ_API_KEY` | Habilita o provider Groq. |
| `HF_TOKEN` | Habilita o provider Hugging Face. |
| `KAZER_PROVIDER_ORDER` | Ordem explícita, por exemplo `groq,huggingface`. |
| `GROQ_MODEL` / `KAZER_TEXT_MODEL` | Modelo de texto principal por provider. |
| `GROQ_CODE_MODEL` / `KAZER_CODE_MODEL` | Modelo opcional para código. |
| `KAZER_CODE_MAX_OUTPUT_TOKENS` | Teto de saída para código; limitado pelo servidor entre 8.000 e 20.000 tokens. |
| `GROQ_VISION_MODEL` / `KAZER_VISION_MODEL` | Modelo principal para imagens. |
| `*_FALLBACK_MODEL` | Modelo usado após falha real do principal. |
| `HF_CHAT_ENDPOINT` | Endpoint OpenAI-compatible do Hugging Face. |

Pedidos classificados como `coding` usam somente o **Qwen Coder via Hugging Face**. Conversas comuns preservam a ordem geral configurada. Se `HF_TOKEN` não estiver disponível, uma tarefa de código retorna indisponibilidade em vez de trocar silenciosamente para um modelo geral.

A ordem e os nomes de modelo são configuração operacional, não instruções para o modelo. Nunca coloque valores de secrets no repositório, README, frontend ou logs.

## Modo Computer, Vercel e KAZER Pro

| Variável | Função |
|---|---|
| `E2B_API_KEY` | Habilita o terminal em sandbox; só é oferecido ao Brain no modo Computer. |
| `KAZER_CONNECTOR_ENCRYPTION_KEY` | Chave (≥ 32 caracteres) que cifra tokens do GitHub, da Vercel e de MCPs. |
| `ABACATEPAY_API_KEY` | Chave da Abacate Pay. Sem ela, o checkout responde 503 e a interface avisa que o Pro abre em breve. |
| `ABACATEPAY_WEBHOOK_SECRET` | Segredo do webhook. Cadastre na Abacate Pay a URL `https://SEU-DOMINIO/api/billing/webhook?webhookSecret=<valor>` com o evento `billing.paid`. |
| `KAZER_PRO_PRICE_MONTHLY_CENTS` / `KAZER_PRO_PRICE_YEARLY_CENTS` | Preços em centavos (padrão R$ 29,90 e R$ 299,00). |

Aplique `database/supabase/023_vercel_and_pro_billing.sql` antes de ativar a cobrança: ela cria as tabelas de conexão Vercel, cobranças e assinaturas e torna `get_my_usage`/`consume_kazer_usage` sensíveis ao plano (Free 1.000 eventos, Pro 10.000).

O webhook não confia só no segredo: ele confirma na API da Abacate Pay que a cobrança está `PAID` antes de chamar `kazer_activate_pro`, que é idempotente.
