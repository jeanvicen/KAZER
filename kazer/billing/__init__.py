"""Cobrança do KAZER: economia dos planos, modelos premium, créditos e Stripe.

- `economics`: quanto de cada assinatura vira taxa, imposto, reserva, margem e
  orçamento de API (os créditos que a pessoa usa nos modelos premium).
- `catalog`: os modelos premium (Claude, GPT, Kimi), preço por token e quem libera.
- `credits`: o extrato do mês de cada conta (quanto do orçamento já foi gasto).
- `stripe_webhook`: confere a assinatura do Stripe e ativa/renova/cancela o plano.
"""
