# Catálogo de extrações

Cada entrada: **gatilho** (quando aplicar) e **cuidado** (quando não).

---

## Extrair funções puras

**Gatilho:** regra de negócio que faz I/O no meio do cálculo.
**Exemplo:** `calculateDiscount()` que lê config do banco entre duas fórmulas.
**Resultado:** `calculateDiscount(input): number` + `loadDiscountConfig()` separado.
**Cuidado:** a função pura precisa de **todos** os dados de entrada. Se ela
busca "a configuração atual" internamente, não é pura.

---

## Extrair repositório (interface + implementação)

**Gatilho:** a camada de regra chama o banco diretamente.
**Exemplo:** `BillingService` executa SQL.
**Resultado:** `interface BillingRepository` + `PgBillingRepository`.
**Cuidado:** a interface deve ter os **verbs de domínio** (`findInvoiceById`),
não os de SQL (`selectFrom`). Interface que vira SQL marketada não abstrai nada.

---

## Inverter dependência

**Gatilho:** o módulo de alto nível (regra) depende do de baixo nível (I/O).
**Exemplo:** `DomainService` importa `PostgresClient`.
**Resultado:** o serviço recebe a dependência no construtor; a composição (raiz)
escolhe a implementação.
**Cuidado:** inverta **uma** dependência por vez. Inverter todas junto produz
uma reescrita que não se pode revisar.

---

## Remover `if legacy` scattered

**Gatilho:** a mesma condição de feature flag aparece em 3+ lugares.
**Exemplo:** `if (useNewPricing)` repetido em 4 controllers.
**Resultado:** um único ponto de decisão (Strategy ou Strategy Table).
**Cuidado:** a flag precisa de **data de remoção**. Bandeira sem prazo é dívida
com estandeira.

---

## Extrair módulo de valor (Value Object)

**Gatilho:** o mesmo grupo de campos sempre viaja junto e tem regra própria.
**Exemplo:** `(amount, currency)` que nunca Should travels separadamente.
**Resultado:** `Money` com invariantes no construtor.
**Cuidado:** não use value object para o que é só um `type` alias. Se não há
invariante ou comportamento, é typescript puro.

---

## Substituir `if/else` por strategy

**Gatilho:** 4+ ramos daquela mesma forma sobre o mesmo dado.
**Exemplo:** 5 condições de desconto.
**Resultado:** tabela de estratégias.
**Cuidado:** 2–3 ramos são mais legíveis como `if`. Strategy para 2 casos
é cerimônia sem ganho.

---

## Extrair cálculo de formatação

**Gatilho:** a mesma formatação (moeda, data, percentual) repetida.
**Exemplo:** `R$ ${(v/100).toFixed(2)}` em 6 lugares.
**Resultado:** `formatBRL(v)`.
**Cuidado:** a formatação errada em 6 lugares é 1 bug, não 6. Considere corrigir
o bug central em vez de extrair 6 funções.

---

## Extrair constante nomeada

**Gatilho:** literal mágico que já explicava algo por conta própria.
**Exemplo:** `86400` (segundos por dia).
**Resultado:** `const SECONDS_PER_DAY = 86_400`.
**Cuidado:** `const x = 5` sem contexto **não** é melhoria. A constante precisa
dizer algo que o literal não dizia.

---

## Extrair contexto de execução

**Gatilho:** 4+ parâmetros de função que sempre viajam juntos.
**Exemplo:** `(userId, tenantId, requestId, locale)`.
**Resultado:** `ExecutionContext`.
**Cuidado:** não crie o contexto se os parâmetros não têm a mesma taxa de
mudança. `locale` muda raramente, `tenantId` sempre.

---

## Ordem de aplicação

1. **Funções puras** — maior ganho, menor risco
2. **Constantes** — trivial, elimina magias
3. **Módulos de valor** — médio, ganho de segurança de tipo
4. **Repositório** — médio, habilita teste
5. **Inversão de dependência** — médio-alto
6. **Strategy** — alto, use quando o problema é repetição de forma
7. **Feature flags** — o mais arriscado, sempre por último
