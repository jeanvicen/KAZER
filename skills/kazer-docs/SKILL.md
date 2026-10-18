---
name: kazer-docs
description: Use quando o usuário pedir um documento, proposta, relatório, contrato, ata, README, resumo executivo ou qualquer texto longo formatado para entrega. Produz Markdown, PDF ou DOCX prontos, com estrutura profissional, sumário e tom calibrado pelo público. Ative para "escreva um relatório sobre", "crie uma proposta para", "redige um e-mail/contrato", "resuma isto num documento".
version: 1.0.4
tags: [documento, proposta, relatório, PDF, DOCX, escrita]
permissions: [files.write, web.read]
model_requirements: [kazer-4]
---

# KAZER Docs

Documento que sai pronto para enviar, não rascunho que pede revisão.

## Quando ativar

- "Escreva um relatório/proposta/contrato/ata sobre X"
- "Transforme Y num documento formal"
- "Resuma isto em 2 páginas"
- Qualquer entrega textual longa (>400 palavras) destinada a terceiro.

Não ative para: resposta pontual em chat, e-mail de 3 linhas, explicação
técnica que cabe num parágrafo.

## Fluxo obrigatório

### 1. Levantar antes de escrever

Antes de redigir, resolva internamente (sem perguntar ao usuário se dá para
inferir com segurança):

| Elemento | Padrão se não informado |
|---|---|
| Público | Profissional genérico, sem jargão pesado |
| Tom | Formal-neutro |
| Extensão | 600–1000 palavras, ou o que foi pedido |
| Formato | Markdown por padrão; PDF/DOCX se pedido |
| Idioma | Português (BR), salvo indicação contrária |

Se o público ou o tom forem **ambíguos de forma que muda o documento**
(ex.: "escreva para o conselho" vs "escreva para o cliente final"), aí sim
pergunte — uma pergunta, não um interrogatório.

### 2. Estrutura

Documentos longos sempre têm esta espinha:

```markdown
# Título

> Subtítulo ou resumo de uma linha — o que o leitor leva se ler só isso.

## Resumo executivo
3–5 frases. A conclusão e a recomendação.

## 1. Contexto
Por que este documento existe agora.

## 2. [Seções de conteúdo]
## 3. [Seções de conteúdo]

## Riscos e limitações
O que este documento não cobre. Honestidade vende mais que confiança cega.

## Próximos passos
Quem faz o quê, quando.
```

Regras:
- **Sumário executivo obrigatório** acima de 500 palavras.
- Numeração de seções quando passar de 4 seções.
- "Riscos e limitações" é obrigatório em proposta e relatório técnico.
- "Próximos passos" com dono e prazo quando for proposta ou plano.

### 3. Redigir

- **Frases curtas.** Máximo 25 palavras por frase, 3 por parágrafo.
- Parágrafo de 2–4 linhas. Parede de texto é sinal de documento mal editado.
- **Verbo no presente do indicativo** para fatos, **imperativo** para instruções.
- Números decimais com vírgula (R$ 59,99 — não R$ 59.99).
- Datas por extenso na primeira menção: "17 de novembro de 2026".
- Sem adjetivo vazio: em vez de "solução inovadora", diga o que ela faz.
- **Negrito sparingly** — no máximo 1 a cada 5 parágrafos. Se tudo é importante,
  nada é.

### 4. Adaptar ao público

| Público | Ajuste |
|---|---|
| Executivo | Decisão primeiro, evidência depois. Máx. 1 página por seção. |
| Técnico | Precisão, premissas, reprodutibilidade. Sem resumir método. |
| Jurídico | Cláusulas, referência cruzada, ausência de ambigüidade. |
| Cliente | Benefício antes de mecanismo. Evitar jargão interno. |
| Público geral | Analogias, sem sigla não explicada. |

### 5. Entregar

- **Markdown** como formato base, sempre.
- **PDF** quando o usuário pediu algo "para enviar/imprimir".
- **DOCX** quando pediu "editável" ou é documento de trabalho corporativo.
- Nomeie o arquivo com data e tema: `proposta-comercial-2026-11-17.md`.

Ao gerar PDF ou DOCX, o artefato entra no painel direito da conversa com
ícone do tipo, preview, download e versionamento.

## Anti-padrões

| Não faça | Faça |
|---|---|
| "Este documento visa apresentar..." | Comece pelo conteúdo |
| Adjetivos vagos no título | Título que diz o que é |
| Repetir o resumo na intro | Resumo != introdução |
| Seção "Conclusão" genérica | Recomendação com ação e prazo |
| Bullets que são frases de 30 palavras | Bullets de uma linha; resto em prosa |
| Esconder o que não se sabe | "Não avaliamos X neste documento." |

## Critério de pronto

- [ ] Sumário executivo presente (se > 500 palavras)
- [ ] Título diz o que o documento é
- [ ] Nenhum parágrafo passa de 4 linhas
- [ ] Riscos e limitações presentes (proposta/relatório técnico)
- [ ] Próximos passos com dono e prazo (proposta/plano)
- [ ] Formato e nome de arquivo conforme pedido
- [ ] Artefato anexado e vinculado à conversa

## Referências

- `references/structures.md` — estruturas prontas por tipo de documento
- `references/tone.md` — registro de voz por público e como calibrar
- `scripts/render_doc.py` — converte Markdown em PDF e DOCX
