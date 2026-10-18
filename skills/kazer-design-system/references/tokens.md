# KAZER — Tokens

Fonte única de verdade. Web (`kazer-web/src/styles/tokens.css`), mobile
(`kazer-mobile/constants/tokens.ts`) e core (`kazer-core/src/tokens/`) derivam
deste arquivo. **Nunca invente um valor fora daqui.**

## 1. Cor — tema escuro (padrão)

### Superfícies (azul-violeta muito escuro)

| Token | Valor | Uso |
|---|---|---|
| `--kazer-void` | `oklch(0.115 0.010 285)` | fundo da página, área atrás de modais |
| `--kazer-base` | `oklch(0.145 0.012 285)` | fundo do app, chat |
| `--kazer-surface` | `oklch(0.185 0.014 283)` | sidebar, cards, painel lateral |
| `--kazer-elevated` | `oklch(0.225 0.016 280)` | popover, dropdown, hover |
| `--kazer-overlay` | `oklch(0.265 0.018 278)` | tooltip, drag handle, badge alto |
| `--kazer-inset` | `oklch(0.165 0.013 284)` | campo de input, code block |

### Bordas

| Token | Valor | Uso |
|---|---|---|
| `--kazer-line` | `oklch(1 0 0 / 8%)` | divisória padrão |
| `--kazer-line-strong` | `oklch(1 0 0 / 14%)` | hover, borda de card em foco |
| `--kazer-line-active` | `oklch(1 0 0 / 22%)` | ativo, selecionado, foco de teclado |
| `--kazer-line-gold` | `oklch(0.82 0.135 82 / 38%)` | borda de destaque da marca |

### Texto

| Token | Valor | Uso |
|---|---|---|
| `--kazer-text` | `oklch(0.96 0.008 85)` | texto primário (branco quente) |
| `--kazer-text-2` | `oklch(0.72 0.012 280)` | secundário, metadados |
| `--kazer-text-3` | `oklch(0.65 0.014 285)` | terciário, placeholders, timestamps; contraste AA no tema escuro |
| `--kazer-text-inverse` | `oklch(0.14 0.012 285)` | texto sobre superfície dourada/violeta |

### Acentos

| Token | Valor | Papel |
|---|---|---|
| `--kazer-gold` | `oklch(0.82 0.135 82)` | **marca** — CTA primário, logo, Missão Trace |
| `--kazer-gold-soft` | `oklch(0.72 0.110 80)` | borda/hover dourado |
| `--kazer-gold-dim` | `oklch(0.55 0.075 75)` | dourado sobre fundo claro, texto disabled |
| `--kazer-gold-wash` | `oklch(0.82 0.135 82 / 12%)` | fundo de chip dourado, badge |
| `--kazer-violet` | `oklch(0.62 0.190 295)` | **raciocínio/agente** — modo Missão, Skill ativa |
| `--kazer-violet-soft` | `oklch(0.70 0.150 292)` | hover violeta |
| `--kazer-violet-wash` | `oklch(0.62 0.190 295 / 14%)` | fundo de bloco de raciocínio |
| `--kazer-cyan` | `oklch(0.78 0.130 205)` | **ação ao vivo** — streaming, executando, progresso |
| `--kazer-cyan-wash` | `oklch(0.78 0.130 205 / 13%)` | fundo de chip de status live |
| `--kazer-green` | `oklch(0.75 0.140 155)` | tool_run concluído, sucesso |
| `--kazer-green-wash` | `oklch(0.75 0.140 155 / 13%)` | fundo de badge de sucesso |
| `--kazer-red` | `oklch(0.65 0.190 25)` | erro, falha, ação destrutiva |
| `--kazer-red-wash` | `oklch(0.65 0.190 25 / 14%)` | fundo de erro, borda de input inválido |
| `--kazer-amber` | `oklch(0.80 0.150 75)` | aviso, limite próximo do fim |

### Gradiente metálico (uso restrito)

Aplicado **apenas** no logo, no anel do botão primário e no topo do paywall.

```css
--kazer-metal: linear-gradient(
  145deg,
  oklch(0.88 0.140 88) 0%,
  oklch(0.78 0.135 82) 32%,
  oklch(0.62 0.105 72) 58%,
  oklch(0.86 0.130 90) 100%
);
```

Proibido: gradiente como fundo decorativo de seção, wash por trás de texto
corrido, ou "blob" no fundo da landing. O dourado em texto sobre fundo escuro
precisa de contraste ≥ 4.5:1 — prefira `oklch(0.86 0.140 88)` para texto.

## 2. Cor — tema claro

| Token | Valor |
|---|---|
| `--kazer-void` | `oklch(0.960 0.004 85)` |
| `--kazer-base` | `oklch(0.985 0.003 85)` |
| `--kazer-surface` | `oklch(1 0 0)` |
| `--kazer-elevated` | `oklch(0.975 0.004 85)` |
| `--kazer-overlay` | `oklch(0.94 0.005 85)` |
| `--kazer-inset` | `oklch(0.955 0.004 85)` |
| `--kazer-line` | `oklch(0.20 0.015 285 / 10%)` |
| `--kazer-line-strong` | `oklch(0.20 0.015 285 / 18%)` |
| `--kazer-line-active` | `oklch(0.20 0.015 285 / 30%)` |
| `--kazer-text` | `oklch(0.22 0.020 285)` |
| `--kazer-text-2` | `oklch(0.42 0.018 283)` |
| `--kazer-text-3` | `oklch(0.55 0.015 285)` |
| `--kazer-gold` | `oklch(0.58 0.115 70)` |
| `--kazer-gold-soft` | `oklch(0.50 0.095 68)` |
| `--kazer-violet` | `oklch(0.48 0.185 295)` |
| `--kazer-cyan` | `oklch(0.52 0.115 205)` |

No tema claro, `--kazer-gold` escurece porque o dourado claro não passa em AA
sobre branco. A identidade não muda — muda a luminância para manter contraste.

## 3. Tipografia

| Papel | Família | Tamanho | Line-height | Peso | Tracking |
|---|---|---|---|---|---|
| Display | Geist | 64/68 | | 500 | -0.03em |
| H1 | Geist | 40/46 | | 500 | -0.02em |
| H2 | Geist | 28/34 | | 500 | -0.015em |
| H3 | Geist | 20/26 | | 550 | -0.01em |
| Body-lg | Geist | 17/26 | | 400 | -0.005em |
| Body | Geist | 15/24 | | 400 | 0 |
| Body-sm | Geist | 14/20 | | 400 | 0 |
| Caption | Geist | 13/18 | | 450 | 0.01em |
| Micro | Geist | 12/16 | | 500 | 0.02em |
| Code | Geist Mono | 13/20 | | 400 | 0 |
| Code-sm | Geist Mono | 12/18 | | 400 | 0 |

- **Peso máximo 550.** Nada de 700 em texto corrido.
- **Eyebrow label:** 12px, `uppercase`, tracking `0.08em`, `text-3`. Use
  **apenas** para rótulo de seção real (ex.: "Fontes", "Execução"). Nunca como
  decoração repetitiva em todo card.
- **Resposta longa:** linha de leitura ≤ 76 caracteres (largura ~720px).
- **Números e saída de tool:** `Geist Mono` com `font-variant-numeric: tabular-nums`.

## 4. Espaçamento

Base 4px. Steps: `4 8 12 16 20 24 32 40 48 64 80 96 128`.

| Contexto | Valor |
|---|---|
| padding de card | 16–20px |
| gap entre mensagens | 24px |
| gap entre blocos de uma resposta | 12px |
| padding de painel lateral | 16px |
| topo do composer (web) | 16px |
| altura do composer (web) | 56px mínimo, textarea até 200px |

## 5. Raios

| Token | Valor | Uso |
|---|---|---|
| `--radius-xs` | 4px | tag, badge |
| `--radius-sm` | 6px | chip, citation inline |
| `--radius-md` | 10px | input, botão, select |
| `--radius-lg` | 14px | card, source card, artifact card |
| `--radius-xl` | 20px | painel, modal, bottom sheet |
| `--radius-full` | 999px | pill, avatar |

## 6. Sombra e profundidade

Preferência por **hairline + camada**. Sombra só para elemento flutuante.

```css
--shadow-sm: 0 1px 2px oklch(0 0 0 / 30%);
--shadow-md: 0 4px 16px -4px oklch(0 0 0 / 45%);
--shadow-lg: 0 16px 48px -12px oklch(0 0 0 / 60%);
--shadow-gold: 0 0 0 1px oklch(0.82 0.135 82 / 30%),
               0 8px 32px -8px oklch(0.82 0.135 82 / 22%);
```

## 7. Motion

| Token | Duração | Easing |
|---|---|---|
| `--dur-fast` | 120ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--dur-base` | 200ms | `cubic-bezier(0.2, 0, 0, 1)` |
| `--dur-slow` | 320ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--dur-slower` | 480ms | `cubic-bezier(0.16, 1, 0.3, 1)` |

Cascata de painéis: 40ms de atraso por item, teto de 6 itens.

## 8. Z-index

| Camada | Valor |
|---|---|
| base | 0 |
| conteúdo elevado | 10 |
| sticky | 100 |
| sidebar / drawer | 200 |
| bottom sheet | 300 |
| modal / dialog | 400 |
| toast | 500 |
| toast de streaming | 600 |

## 9. Métricas de layout

| Contexto | Valor |
|---|---|
| sidebar web | 264px (recolhível para 0) |
| painel de fontes web | 340px |
| coluna de resposta | 720px máx. |
| largura total da shell | 1440px máx., centralizado |
| topo do composer (web) | 96px (input 56 + hints) |
| bottom sheet mobile | 72vh máx. |
| safe area mobile | `env(safe-area-inset-*)` |

## 10. Grid de breakpoints

| Nome | Largura | Comportamento |
|---|---|---|
| `sm` | 640px | 1 coluna, bottom sheet |
| `md` | 768px | 1 coluna, sidebar vira drawer |
| `lg` | 1024px | sidebar visível, painel vira bottom sheet |
| `xl` | 1280px | 3 colunas (sidebar + chat + painel) |
| `2xl` | 1536px | shell máximo 1440px |

Abaixo de `lg`, o painel de fontes **nunca** some: ele vira bottom sheet
acionado pelo botão "Fontes (5)" na barra superior.
