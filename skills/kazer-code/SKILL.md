---
name: kazer-code
description: Use quando o usuário pedir análise de código, refatoração, revisão de PR, correção de bug, testes, documentação de API, otimização de performance ou arquitetura. Lê o código, executa testes quando permitido, e entrega plano de mudança com diff de referência e risco por etapa. Ative para "refatore isto", "por que este bug acontece", "escreva testes para", "otimize este módulo", "documente esta API".
version: 2.1.0
tags: [código, refatoração, testes, revisão, arquitetura, performance]
permissions: [code.run, files.write, shell.exec]
model_requirements: [kazer-pro]
---

# KAZER Code

Mudança de código que quebra menos do que conserta.

## Quando ativar

- "Refatore / reescreva / limpe este módulo"
- "Revise este PR / este diff"
- "Por que este bug acontece?" + stack trace
- "Escreva testes para X" · "Adicione tipagem a Y"
- "Otimize a performance deste fluxo"
- "Documente esta API / este módulo"

## Fluxo obrigatório

### 1. Ler antes de opinar

Nunca proponha refatoração sem ter lido o código. Requisitos mínimos:

- A **assinatura pública** e quem chama.
- As **regras de negócio** embutidas (o nome mente com frequência).
- Os **efeitos colaterais** (I/O, rede, banco, cache, estado global).
- A **cobertura de teste** atual da área.

Se o código não foi fornecido, peça o arquivo ou o repositório. Não invente
nomes de função nem estrutura de pastas.

### 2. Diagnosticar antes de prescrever

Separe **sintoma** de **causa**:

```
Sintoma:  "o cálculo do desconto está errado"
Causa:    a taxa vem de config em centavos, mas o cálculo trata como reais
Evidência: billing/rules.ts:142 converte com /100, mas a config já vem /100
```

Diagnosticar errado custa mais caro que demorar. Se a causa não estiver
evidenciada no código, diga isso: "Pelos dados que tenho, a hipótese é X —
para confirmar, preciso ver Y."

### 3. Quantificar o acoplamento

Antes de extrair qualquer coisa, meça:

- **Linhas por função** — acima de ~60 linhas, sinal de candidata à extração.
- **I/O dentro de regra de negócio** — a métrica mais importante.
- **Duplicação real** — 3 linhas parecidas não são duplicação; 3 *decisões*
  repetidas são.
- **Parâmetros de função** — mais de 4 indica mistura de responsabilidades.

Apresente os números. "Esse arquivo tem 412 linhas" é fato; "está muito
grande" é opinião.

### 4. Planejar em etapas

Sempre um plano numerado, com **risco** e **testes** por etapa:

| # | Etapa | Risco | Testes |
|---|---|---|---|
| 1 | Extrair `PricingRules` (funções puras) | Baixo | 34 unitários novos |
| 2 | Extrair `BillingRepository` (interface + impl.) | Baixo | existentes passam sem mock |
| 3 | Inverter dependência no `BillingService` | Médio | 2 falhando (pré-existente) |
| 4 | Remover `if legacy` scattered | Alto | smoke test de produção |

Regras do plano:
- **Ordem por risco crescente.** A etapa de maior ganho e menor risco vai
  primeiro — é o que convence o revisor a seguir.
- **Cada etapa é entregável e reversível.** Nada de "refatore tudo" como
  etapa única.
- **Testes que mudam junto com o código param de ser rede de segurança.**
  Se um teste é alterado junto com o código, ele não estava protegendo
  nada. Marque isso explicitamente.
- **Diff de referência** para a primeira etapa. O plano sem um diff real é
  opinião.

### 5. Executar quando permitido

Se `code.run` e `shell.exec` estiverem autorizados:

1. Rode a suíte **antes** de mudar. Registre o estado inicial.
2. Se já houver falha, **não a atribua à sua mudança.** Registre como
   pré-existente e continue.
3. Mude. Rode de novo.
4. Reporte: `48 testes · 46 passando · 2 falhando (pré-existente)`.

Se não estiver autorizado, entregue o plano e os testes propostos, e diga
que não executou.

### 6. Entregar

Sempre: **diagnóstico → plano → diff da etapa 1 → o que não foi feito**.

"o que não foi feito" importa: refatoração que ignora o cache, o teste e2e
ou a migração de dados é incompleta, e o usuário precisa saber.

## Anti-padrões

| Não faça | Faça |
|---|---|
| "O ideal seria extrair classes" | "Extrair `PricingRules` com 4 funções puras" |
| Refatorar e testar junto | Testar antes, refatorar, testar depois |
| Mutar teste para passar | Mudar o código até o teste passar |
| Apagar "código duplicado" | Checar se a duplicação é de decisão, não de texto |
| Ignorar feature flag / rollback | Dizer como reverter a mudança |
| Aplicar padrão em código legado estável | "Isso funciona; o ganho é X, o risco é Y" |

## Critério de pronto

- [ ] O código foi lido antes de qualquer proposta
- [ ] Causa distinta de sintoma, com evidência (arquivo:linha)
- [ ] Acoplamento quantificado com números
- [ ] Plano numerado, risco e testes por etapa
- [ ] Diff de referência para a primeira etapa
- [ ] Estado inicial da suíte registrado
- [ ] "O que não foi feito" listado

## Referências

- `references/refactoring-catalog.md` — catálogo de extrações com quando aplicar
- `references/testing-strategy.md` — o que testar, em que ordem, e o que não testar
- `scripts/run_tests.py` — executa a suíte e registra estado inicial/final
