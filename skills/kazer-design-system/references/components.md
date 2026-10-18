# KAZER — Componentes

Regras de comportamento. Cada componente implementa as duas plataformas
(`kazer-web` e `kazer-mobile`) com a **mesma identidade**, adaptando apenas o
layout e o gesto.

## 1. Mission Trace — a assinatura

Rail vertical de 2px à esquerda da resposta do agente. Uma unidade por passo.
O nó acende conforme o passo avança.

Passos canônicos: `intenção → buscas paralelas → fontes lidas → síntese → artefato`.

```
  ● Intenção entendida
  │  "Comparar pricing de LLMs no Brasil em 2026"
  ● 4 buscas em paralelo
  │  ├─ pricing openai brasil
  │  └─ pricing anthropic brasil
  ◐ 7 fontes lidas
  ○ Síntese
  ○ Artefato criado
```

Regras:
- Estado: `pending` (linha apagada, nó `○` a 35% opacidade) · `active`
  (nó `◐` com pulso, borda da cor semântica) · `done` (nó `●` filled).
- A linha entre nós é gradiente vertical de `surface` para a cor do passo ativo.
- O passo ativo pode ter uma **sub-linha mono** com o detalhe real
  (ex.: `4 buscas em paralelo · 1.8s`).
- Nunca piscar. Nunca usar spinner genérico.
- Acessível: a lista é `role="list"`, cada item `role="listitem"` com
  `aria-current="step"` no ativo e `aria-label` descrevendo o estado.

## 2. Composer

- Textarea auto-expande até 200px (web) / 140px (mobile).
- Esquerda: botão de **modo** (Chat · Research · Missão). É um segmented control
  horizontal, não dropdown, no desktop; no mobile vira sheet com opções grandes.
- Direita: **modelo** (chip com nome curto, ex.: `KAZER 4`), botão de anexar e
  botão de enviar.
- O botão de enviar é dourado e vira ícone de stop durante streaming.
- Mode = Research → o chip ganha anel ciano. Mode = Missão → anel violeta.
- Teclas: `Enter` envia, `Shift+Enter` quebra linha. No mobile, o botão de
  enviar fica acima do teclado (keyboard avoidance).
- Placeholder por modo:
  - Chat: `Pergunte qualquer coisa ao KAZER…`
  - Research: `O que o KAZER deve pesquisar?`
  - Missão: `Descreva a missão e o resultado esperado…`

## 3. Message bubble

Regra central: **o KAZER não usa bubbles de chat.** A mensagem do agente é
conteúdo em fluxo, alinhado à esquerda, com o Mission Trace à esquerda. A
mensagem do usuário é um bloco de superfície com borda à direita, no máximo
560px, e sem avatar.

- Resposta do agente: sem container; tipografia de leitura, linha ≤ 76ch.
- Mensagem do usuário: `--kazer-surface`, borda 1px, raio 14px, canto
  inferior direito 4px (marca de autoria, não decoração).
- Timestamp: só no hover, `text-3`, 12px, à direita.
- Ação no hover: copiar, regenerar, editar pergunta, exportar.

## 4. Citation chip `[1]`

- Inline, entre parênteses retos, mono, 12px.
- `oklch(0.86 0.140 88)` sobre `--kazer-gold-wash`, borda `gold/30%`.
- Raio 6px, padding `1px 5px`, `vertical-align: super` sutil (0.4em).
- **Hover/focus** → abre popover com a fonte: título, domínio, trecho.
- **Click** → rola até o card da fonte no painel e o destaca por 1.6s
  (flash de borda dourada). No mobile, abre o bottom sheet de fontes.
- Estado ativo (quando o card correspondente está selecionado): fundo sólido
  `--kazer-gold`, texto `--kazer-text-inverse`.
- `aria-label`: `Fonte 1: título — domínio`.

## 5. Source card

- Favicon 16px em círculo, ao lado do domínio em `text-3` 12px.
- Título em 14px, 2 linhas máx., `text`.
- Trecho em 13px `text-2`, 3 linhas, com o termo buscado em **dourado**.
- Ações: abrir (nova aba), salvar, citar. Ícones 16px, alvo 32px (web).
- Estados: `default` · `hover` (elevated) · `active` (borda dourada) ·
  `saved` (ícone de check).
- Favicon usa `https://www.google.com/s2/favicons?domain=` com fallback de
  inicial do domínio.

## 6. Tool run row

Linha compacta, mono, dentro do Mission Trace.

```
● web_search          4 resultados          1.8s
● code_interpreter    executado             0.4s
◐ fetch_page          lendo…                
✕ shell_exec          timeout após 30s
```

- Nome da tool em mono 12px; status em `text-3`; duração à direita em tabular-nums.
- Verde quando `done`, ciano pulsando quando `running`, vermelho quando `error`.
- Clicável: expande o output (mono, `inset`, scroll horizontal).

## 7. Artifact card

- Preview de 96px à esquerda (miniatura, ou ícone do tipo).
- Tipo + nome, badge de versão (`v3`), tamanho.
- Ações: preview, download, compartilhar, abrir.
- **Plano travado:** card renderiza com overlay `--kazer-rose` sutil e cadeado.
  Nunca esconder o artefato — mostrar que existe e o que libera.

## 8. Citation panel (Fontes)

Ordem: busca no topo (filtra por domínio/título) → lista de cards → rodapé com
"Salvar todas" e contagem `5 fontes · 12 lidas`.
Sem busca e sem resultado: empty state com ícone e texto curto.

## 9. "KAZER está pensando"

Nunca um spinner. Estrutura:
- Três barras horizontais que respiram em sequência (stagger 120ms) em `--kazer-cyan`.
- Rótulo abaixo, 13px `text-2`: `KAZER está pensando` + etapa atual
  (`Lendo 7 fontes…`).
- Bloco de raciocínio (quando o modelo expõe) em `--kazer-violet-wash`,
  borda esquerda violeta 2px, mono 13px, colapsável.

## 10. Skeletons

- Busca: 4 cards de fonte com shimmer de 90° em `--kazer-elevated` → `--kazer-surface`.
- Streaming: 3 linhas de texto com larguras 92% / 78% / 60%.
- Histórico: 6 linhas de 32px.
- Shimmer: `linear-gradient(90deg, transparent, oklch(1 0 0 / 5%), transparent)`
  em 1.6s linear infinito. `prefers-reduced-motion` → opacidade estática.

## 11. Botões

| Variante | Fundo | Texto | Borda | Uso |
|---|---|---|---|---|
| `primary` | `--kazer-gold` | `--kazer-text-inverse` | — | CTA único por tela |
| `secondary` | `--kazer-surface` | `--kazer-text` | `--kazer-line` | ação comum |
| `ghost` | transparente | `--kazer-text-2` | — | ação terciária, ícone |
| `outline-gold` | transparente | `--kazer-gold` | `gold/40%` | segundo destaque, assinar |
| `danger` | `--kazer-red-wash` | `--kazer-red` | `red/30%` | excluir, cancelar assinatura |

- Microinteração: `scale(0.97)` no `:active`, `translateY(-1px)` no hover do
  `primary`. Transição 120ms.
- Foco: `outline 2px solid var(--kazer-gold); outline-offset 2px`.
- Ícone à esquerda do texto: **não** use seta `→`. Use ícone de 16px ou nada.
- Botão desabilitado: opacidade 45%, `cursor: not-allowed`, mas **nunca** some.

## 12. Paywall modal

- Overlay `oklch(0 0 0 / 72%)` com `backdrop-filter: blur(8px)`.
- Container 460px, `--kazer-surface`, raio 20, borda `gold/30%`, sombra `shadow-gold`.
- Topo: anel dourado metálico de 56px com o glyph do KAZER.
- Título 24px, subtítulo 15px `text-2`.
- Preço: `R$ 59,99` em 36px + `/mês` 15px `text-3`.
- Benefícios: lista com ícone de check dourado, 14px, gap 10px.
- Botão primário largo: `Ativar KAZER MAX`.
- Link discreto: `Continuar no plano atual` — 13px `text-3`, hover `text-2`.
- `role="dialog"` `aria-modal="true"` `aria-labelledby`. Foco preso. `Esc` fecha.

## 13. Estados de erro

- Erro inline: ícone de alerta + mensagem em 14px + link de retry. Nunca toast
  apenas — toast some e o usuário perde o contexto.
- Erro de página: card centralizado com título curto, causa em `text-2`,
  botões `Tentar novamente` e `Voltar ao início`.
- Erro de streaming: a mensagem parcial permanece, com banner
  `Resposta interrompida` e botão `Continuar`.

## 14. Acessibilidade por componente

- Todos os botões de ícone: `aria-label` obrigatório.
- Painéis: `<aside aria-label="Fontes">`.
- Streaming: `aria-live="polite"` `aria-atomic="false"`.
- Tabs do painel direito: `role="tablist"` com `aria-selected`.
- Bottom sheet mobile: `role="dialog"`, `aria-modal`, drag handle com
  `aria-label="Arrastar"`, botão de fechar 44×44.
- Todo alvo de toque: ≥ 44×44px no mobile.
