---
name: kazer-research
description: Use quando o usuário pedir pesquisa, comparação, dossiê, relatório com fontes ou verificação de uma afirmação. Gera de 3 a 5 buscas em paralelo, lê e pondera as fontes, e entrega uma resposta direta com citações inline numeradas [1][2][3] e painel de fontes. Ative para perguntas factuais que precisam de dado atual, comparativos de mercado, preço, concorrência, regulation, ou "o que dizem sobre X".
version: 1.2.0
tags: [pesquisa, fontes, dossiê, citação, comparativo, mercado]
permissions: [web.read, net.fetch]
model_requirements: [kazer-4-reasoning]
---

# KAZER Research

Pesquisa que termina em **resposta com fonte**, não em lista de links.

## Quando ativar

- "Compare X e Y" · "quanto custa Z" · "o que o mercado diz sobre"
- "Quem é o líder em X" · "faça um dossiê sobre" · "verifique se é verdade"
- Qualquer pergunta factual que dependa de dado **atual** (preço, regulation, mercado, pessoas).

Não ative para: conversa, escrita criativa, código sem contexto externo, ou
pergunta que você já sabe responder com segurança.

## Fluxo obrigatório

### 1. Classificar a intenção

Classifique em uma de:

| Intenção | Comportamento |
|---|---|
| `comparative` | Comparar 2+ entidades. Tabela obrigatória. |
| `factual_lookup` | Um fato específico. Ir direto ao ponto. |
| `survey` | Panorama amplo de um tema. Mapear divergências. |
| `verify` | Checar uma afirmação. Dizer o veredito explicitamente. |
| `trending` | "O que está acontecendo com X". Recência pesa mais. |

Registre a intenção como primeiro ToolRun — ela aparece no Missão Trace.

### 2. Gerar 3 a 5 queries

Gere queries **distintas**, não sinônimos. Um ângulo por query:

```
pricing llm brasil 2026          ← dado de mercado
custo real llm em produção       ← custo efetivo, não tabela
llm pricing cached vs batch      ← alavanca de custo
tributação de consumo de IA       ← o que a tabela não mostra
```

Evite: query com a resposta no texto ("por que LLMs são caros"), query
genérica ("IA"), e mais de 5 queries (a dispersão derruba a qualidade).

### 3. Buscar em paralelo

Todas as queries disparam **simultaneamente**. Registre como ToolRun
`web_search` com o total bruto e o total após dedup.

### 4. Ler, filtrar e ponderar

- Leia a página, não só o snippet. O snippet engana com frequência.
- Descarte: SEO farms, listas sem data, conteúdo duplicado, agregadores.
- Pontue por relevância (0–1), recência e **credibilidade da fonte**.
- Dedupe por URL canônica e por conteúdo substancialmente igual.
- Meta: 5–9 fontes na resposta, 5–10 citadas inline. Não cite todas — cite
  as que sustentam as afirmações que você faz.

### 5. Sintetizar

**Resposta direta primeiro.** O leitor precisa da conclusão antes do detalhe.

Estrutura obrigatória:

```markdown
## Resposta direta
<1-2 parágrafos. A conclusão. Citações inline aqui.>

### <Sub-tema ou tabela>
<detalhe, tabela, ou lista>

### O que isso significa
<implicação prática para o usuário>

### Recomendação
<o que fazer, se a pergunta permitir>
```

Regras de escrita:
- **Toda afirmação factual relevante leva citação.** Parágrafo sem citação =
  opinião ou raciocínio. Marque raciocínio explicitamente.
- Não comece com "Com base nas fontes consultadas" — comece pela resposta.
- Se as fontes divergirem, **diga que divergem**. Não media sem dizer.
- Dê o número, não o adjetivo. "47% menos" vale mais que "significativamente menos".
- Se um dado for de antes de 12 meses, sinalize: "em 2025, X era Y".

### 6. Citar

Formato: `[1]` inline, colado ao número, não no fim do parágrafo.

```
O cache de prefixo reduz em média 68% dos tokens de entrada[6], o que muda
o cálculo de custo por tarefa[5].
```

Regras:
- Numeração sequencial por ordem de primeira aparição.
- Máximo 10 inline. Acima disso, o leitor perde a rastreabilidade.
- A mesma fonte mantém o mesmo número em toda a resposta.
- Marque fontes principais e de apoio: a principal sustenta a conclusão,
  a de apoio detalha.

### 7. Painel de fontes

Para cada fonte: **título, domínio, favicon, trecho relevante, link**, e
ações abrir / salvar / citar. Ordene por ordem de citação, não por
relevância bruta.

## Anti-padrões

| Não faça | Faça |
|---|---|
| "Segundo a documentação oficial da X..." | A regra é Y, e a fonte oficial confirma[2]. |
| Citar 15 fontes | Citar as 5 que sustentam as afirmações |
| Esconder divergência | "As fontes divergem: A diz X, B diz Y." |
| "É claro que..." | "Segundo A[1], ..." |
| Inventar dado ausente | "Não encontrei valor público para isso." |
| Responder genérico quando pediu específico | Responder o específico, e o genérico como contexto |

## Critério de pronto

- [ ] A resposta começa pela conclusão, não pelo método
- [ ] Toda afirmação factual tem citação
- [ ] As 3–5 queries são distintas entre si
- [ ] Pelo menos uma fonte é primária (documentação, registro oficial, dado)
- [ ] Divergências estão declaradas
- [ ] O painel lista 5+ fontes com trecho real de cada uma
- [ ] 3 follow-ups relevantes foram gerados

## Referências

- `references/quality-bar.md` — o que separa um relatório mediocre de um confiável
- `references/source-tiers.md` — hierarquia de credibilidade e quando usar cada nível
- `scripts/score_sources.ts` — pondera e deduplica resultados de busca
