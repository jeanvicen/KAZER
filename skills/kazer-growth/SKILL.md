---
name: kazer-growth
description: Use quando o usuário pedir estratégia de produto, monetização, pricing, posicionamento, ICP, go-to-market, plano de lançamento, experimentos de growth, retenção ou ativação. Entrega recomendação com números, experimento concreto e critério de decisão — não lista de boas práticas. Ative para "como monetizo", "qual o preço", "lanço isso como", "como aumento conversão/retenção", "faça plano de growth".
version: 1.3.1
tags: [produto, monetização, pricing, lançamento, growth, retenção]
permissions: [web.read, files.write]
model_requirements: [kazer-4]
---

# KAZER Growth

Estratégia com número, experimento e critério de decisão.

## Quando ativar

- "Como eu monetizo isso?" · "Qual preço eu coloco?"
- "Lanço um produto SaaS / mobile / API"
- "Como aumento conversão / retenção / ativação?"
- "Quem é meu ICP?" · "Quais canais eu uso nos primeiros 90 dias?"
- "Crie um plano de growth"

Não ative para: copy de marketing pontual, análise de métricas sem
recomendação, ou pergunta puramente factual.

## Fluxo obrigatório

### 1. Enquadrar antes de recomendar

Sem estes quatro dados, a recomendação é genérica. Inferir com razão, e
declarar as suposições:

| Dado | Por que importa |
|---|---|
| **Modelo de receita** | SaaS, marketplace, consumo, ads — o pricing muda |
| **Unidade de valor** | Por seat, por uso, por resultado? |
| **Ciclo de venda** | Self-serve vs enterprise muda tudo |
| **Tamanho do mercado** | Se é pequeno, precisa de ser denso, não largo |

Se a inferência for arriscada, pergunte **uma** coisa: "você vende por
assinatura ou por consumo?" — e siga.

### 2. Posicionamento

Escreva o posicionamento em **uma frase** antes de qualquer tática:

```
Para [ICP específico] que [problema concreto], [produto] é [categoria]
que [benefício mensurável], diferente de [alternativa] porque [razão verificável].
```

Teste a frase: se ela servir para três produtos diferentes, não é
posicionamento — é categoria genérica.

A "diferente de" **precisa ser verificável**. "Somos mais inteligentes" não
é. "Respondemos com a fonte de cada afirmação" é.

### 3. Monetização

Escolha **um** modelo principal e justifique:

| Modelo | Serve quando | Cuidado |
|---|---|---|
| Assinatura por seat | Valor cresce com pessoas | Se o produto é individual, seat é errado |
| Assinatura por uso | Consumo previsível e mensurável | Ansiedade de orçamento; considere teto |
| Consumo puro | Uso esporádico, valor alto | Fatia de receita instável |
| Marketplace | Liquidez entre dois lados | Duas vezes o trabalho de onboarding |
| Freemium | Aquisição é o gargalo | Custo de servir os gratuitos |

Para pricing, sempre apresente **3 opções** com a troca explícita:

| Plano | Preço | Para quem | O que ganha | O que perde |
|---|---|---|---|---|

Não dê um preço só. A escolha entre eles é o conteúdo útil.

Regras de preço:
- **Ancore no valor, não no custo.** O que o cliente ganha, dividido por quanto
  custa entregar.
- **Preço redondo é subotimizado.** R$ 99 e R$ 149 convertem melhor que R$ 97.
- **O plano de entrada precisa ser VIT.** Se o free não tem valor, ninguém
  sobe de plano; se não tem limite, ninguém paga.
- **A diferença entre planos é capacidade, não features decorativas.** Quem
  paga mais deve ter mais *de algo que importa*.

### 4. Go-to-market dos primeiros 90 dias

Especifique **canal → mensagem → ação → métrica**, para cada um:

| Canal | Mensagem | Ação | Métrica |
|---|---|---|---|
| Founder-led sales | "Descobrimos X ao fazer Y" | 20 conversas | 3 propostas |
| Conteúdo de fundo | Como X se faz | Post semanal | 50 assinantes |

Escolha **2 canais**, não 7. Nos primeiros 90 dias, foco vence amplitude.

Defina o **ICP de partida** com critérios verificáveis:
- Tamanho da empresa (50–500 funcionários)
- Setor específico
- Gatilho de compra ("acabou de contratar 10 devs" ou "padrão apareceu no código")
- Software que já usam (o canal de distribuição)

### 5. Experimentos

Todo experimento vem com **hipótese, métrica, duração e critério de decisão**:

```markdown
### Experimento 1 — Landing com prova social real
- Hipótese: mostrar números reais de uso (intervalo honesto) aumenta signup
- Métrica: signup visitor → trial, baseline 4.1%
- Duração: 14 dias, 2.000 visitas
- Critério de decisão: abandono do grupo de controle se < 25% de uplift
- Custo: 2 dias de trabalho
```

Critério de decisão **pré-registrado** é o que separa experimento de
hobby. Sem ele, você escolhe o que contar depois.

### 6. Métricas

Escolha **uma métrica norte** e derive:

```
North Star: missões concluídas com artefato aceito (não mensagens)

  ├─ Ativação: % que completa a 1ª missão em 24h
  │    └─ time-to-value
  ├─ Retenção: % que volta na semana 4
  │    └─ frequência de missões
  └─ Receita: MRR por workspace
       └─ upgrades por limite atingido
```

Nomeie **um antipadrão** por métrica norte. Sem isso, a métrica norte
vira métrica de vaidade em 3 meses.

## Anti-padrões

| Não faça | Faça |
|---|---|
| "Foque em retenção e-growth loops" | "Ative 2 canais: sales fundador e 1 conteúdo" |
| "Preço baseado no valor" | Preço, o ICP que paga esse preço, e a alternativa mais barata |
| "Comece no PMF" | "Antes de PMF: 30 entrevistas. Depois: 1 canal." |
| "Faz A/B test" | Hipótese, métrica, duração, critério de decisão |
| "5 canais" | 2 canais, 90 dias, critério para o 3º |
| "Métrica de vaidade" | Métrica norte + 1 antipadrão |

## Critério de pronto

- [ ] Posicionamento em uma frase, com "diferente de" verificável
- [ ] 3 opções de pricing com a troca explícita
- [ ] ICP com critérios verificáveis, incluindo gatilho de compra
- [ ] 2 canais com mensagem, ação e métrica
- [ ] Experimentos com critério de decisão pré-registrado
- [ ] 1 métrica norte + 1 antipadrão
- [ ] Suposições assumidas explicitamente declaradas

## Referências

- `references/pricing-playbook.md` — modelos, âcoras e erros comuns
- `references/gtm-90-days.md` — playbook de lançamento por tipo de produto
- `scripts/model_unit_economics.py` — calcula LTV, CAC e payback a partir de premissas
