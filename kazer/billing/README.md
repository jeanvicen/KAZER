# kazer/billing — cobrança

**O que é:** a parte de dinheiro: o que cada plano dá, os modelos premium
(Claude, GPT, Kimi) com crédito mensal e o webhook do Stripe.

| Arquivo | Papel |
|---|---|
| `catalog.py` | Modelos premium por plano (Pro, Ultra) |
| `credits.py` | Crédito mensal por conta (o "extrato") |
| `metered.py` | Desconta crédito a cada resposta premium |
| `economics.py` | Para onde vai cada real de uma assinatura (margem) |
| `stripe_webhook.py` | Pagamento confirmado liga o plano; cancelamento volta ao grátis |

**Como funciona:** o servidor decide o plano e o modelo; a tela só mostra.
Detalhes de preço e margem: `docs/NEGOCIO.md`. Testes: `tests/test_billing.py`, `tests/test_plans.py`.

**Cuidados:** a assinatura do webhook do Stripe precisa ser verificada sempre.
Chaves só no servidor (Vercel), nunca no front.

---
Mapa geral do repositório: [README principal](../../README.md).
