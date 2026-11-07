# Modelo de negócio do KAZER

## Os planos

| Plano | Preço | O que entrega |
|---|---|---|
| KAZER (grátis) | R$ 0 | KAZ 1.1 (Groq), pesquisa na web, arquivos, memória |
| KAZER Pro | R$ 1.599/mês (R$ 15.990/ano) | KAZ 1.1 com 6x mais uso + Claude Haiku/Sonnet/Opus, GPT e Kimi com crédito mensal |
| KAZER Ultra | R$ 10.000/mês (R$ 100.000/ano) | Tudo do Pro + Claude Fable 5.1 e crédito mensal 6x maior |

O anual vale 10 meses: a pessoa ganha 2 meses de graça.

## Para onde vai cada real (`kazer/billing/economics.py`)

Cada assinatura é dividida automaticamente:

| Parte | Padrão | Para quê |
|---|---|---|
| Taxa do pagamento | 3,99% + R$ 0,39 | Stripe (cartão nacional) |
| Impostos | 6% | Simples Nacional, faixa inicial de software (**confirme com seu contador**) |
| Reserva | 5% | Vercel, Supabase, os usuários grátis (Groq) e estornos |
| **Sua margem** | **10%** | O que fica com você |
| Orçamento de API | o resto (~75%) | Vira o crédito da pessoa nos modelos premium |

Valores com os padrões (câmbio de R$ 5,50 por dólar):

| | Pro mensal | Pro anual (por mês) | Ultra mensal | Ultra anual (por mês) |
|---|---|---|---|---|
| Preço | R$ 1.599,00 | R$ 1.332,50 | R$ 10.000,00 | R$ 8.333,33 |
| Taxa Stripe | R$ 64,19 | R$ 53,56 | R$ 399,39 | R$ 332,89 |
| Impostos | R$ 95,94 | R$ 79,95 | R$ 600,00 | R$ 500,00 |
| Reserva | R$ 79,95 | R$ 66,62 | R$ 500,00 | R$ 416,67 |
| **Sua margem** | **R$ 159,90** | **R$ 133,25** | **R$ 1.000,00** | **R$ 833,33** |
| Crédito de API | R$ 999 (~US$ 182) | R$ 999 (~US$ 182) | R$ 6.250 (~US$ 1.136) | R$ 6.250 (~US$ 1.136) |

O crédito é calculado pelo valor mensal do **anual** para todo mundo. Assim a sua
margem vale nos dois ciclos: quem paga mensal deixa um pouco a mais de sobra.

Todos os percentuais mudam pelo ambiente da Vercel, sem mexer no código:
`KAZER_FEE_PCT`, `KAZER_TAX_PCT`, `KAZER_RESERVE_PCT`, `KAZER_MARGIN_PCT`,
`KAZER_USD_BRL`.

> Opinião honesta: 10% de margem é apertado. Um estorno de cartão ou um mês com
> câmbio alto come a margem inteira. Para começar, 20% a 30% dá mais segurança
> (`KAZER_MARGIN_PCT=25`). O crédito da pessoa diminui na mesma proporção.

## Como o crédito funciona

- Cada resposta de um modelo premium desconta do crédito do mês o custo
  estimado: tokens de entrada × preço de entrada + tokens de saída × preço de
  saída, com 25% de folga para o raciocínio escondido dos modelos.
- A pessoa vê só a porcentagem usada (no seletor de modelos), nunca valores.
- Quando o crédito acaba, os premium travam até o mês virar. O KAZ 1.1 continua
  liberado.
- O gasto fica na tabela `kazer_credit_usage`, que só o servidor escreve. O
  usuário não consegue zerar o próprio gasto.

## "Pagar os tokens automaticamente"

As empresas de IA não vendem tokens por usuário: a conta é sua, uma por empresa.
O fluxo que funciona é este:

1. Crie conta e coloque saldo em cada uma: Anthropic (console.anthropic.com),
   OpenAI (platform.openai.com) e Moonshot (platform.moonshot.ai).
2. Ligue a **recarga automática** em cada painel: quando o saldo baixa de X,
   cobra Y no seu cartão. Assim o saldo nunca zera.
3. Coloque as chaves na Vercel: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `MOONSHOT_API_KEY`. Cada modelo só aparece como disponível com a chave.
4. O dinheiro das assinaturas cai no Stripe e vai para a sua conta. A recarga
   automática das empresas de IA usa esse dinheiro.

O crédito de cada pessoa nunca passa do orçamento de API que o plano dela
pagou. Por isso a conta fecha mesmo que todo mundo use o crédito inteiro.

## Ligar a cobrança (Stripe)

1. Crie os 4 preços no Stripe (Pro e Ultra, mensal e anual) e coloque os IDs
   em `STRIPE_PRICE_PRO_MENSAL`, `STRIPE_PRICE_PRO_ANUAL`,
   `STRIPE_PRICE_ULTRA_MENSAL` e `STRIPE_PRICE_ULTRA_ANUAL`, mais a
   `STRIPE_SECRET_KEY`.
2. Em Desenvolvedores → Webhooks, crie o endpoint
   `https://SEU-DOMINIO/api/stripe/webhook` com os eventos
   `checkout.session.completed`, `invoice.paid` e
   `customer.subscription.deleted`. Copie o "Signing secret" para
   `STRIPE_WEBHOOK_SECRET`.
3. No Supabase, aplique a migração
   `supabase/migrations/20261106120000_kazer_billing.sql` (SQL Editor ou
   `supabase db push`). Ela cria a tabela de créditos e faz o plano vencer
   sozinho se a renovação não chegar.
4. A Vercel precisa da `SUPABASE_SERVICE_ROLE_KEY`, que só o servidor usa para
   gravar plano e crédito.

O que acontece depois:

- Pagou → o webhook confere a assinatura do Stripe e liga o plano.
- Renovou → estende a data de vencimento.
- Cancelou → volta ao grátis.
- Se um aviso do Stripe se perder, o plano vence sozinho 3 dias depois da data
  de renovação.

## Preços dos modelos (`kazer/billing/catalog.py`)

| Modelo | US$ por 1M tokens (entrada / saída) | Fonte |
|---|---|---|
| Claude Haiku 5.5 | 0,10 / 0,50 | tabela oficial da Anthropic |
| Claude Sonnet 5.5 | 2 / 10 | tabela oficial da Anthropic |
| Claude Opus 5.5 | 4 / 20 | tabela oficial da Anthropic |
| Claude Fable 5.1 (só Ultra) | 10 / 50 | tabela oficial da Anthropic |
| GPT | 5 / 30 | referência: **confira** em openai.com/api/pricing |
| Kimi | 0,95 / 4 | referência: **confira** em platform.moonshot.ai |

Para corrigir um preço sem deploy: `KAZER_MODEL_PRICES={"gpt": [5, 30]}`. Para
trocar a versão do modelo: `KAZER_OPENAI_MODEL` e `KAZER_KIMI_MODEL`.
