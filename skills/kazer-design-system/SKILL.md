---
name: kazer-design-system
description: Design system do KAZER — Answer Engine + Agent Workspace. Tokens OKLCH (preto azul-violeta, dourado metálico, violeta de raciocínio, ciano de ação), Mission Trace, tipografia Geist/JetBrains Mono, componentes, motion e acessibilidade. Use ao criar ou alterar qualquer tela, componente ou token do KAZER (web e mobile).
version: 1.0.0
tags: [design-system, kazer, ui, tokens, dark, oklch, motion, accessibility]
---

# KAZER Design System

Identidade: **estação de trabalho de IA**, não chatbot. Escuro por padrão, sério,
futurista, minimalista. Dourado metálico = a marca. Violeta = raciocínio/agente.
Ciano = ação ao vivo. Nada de gradiente decorativo, nada de "→" em todo botão,
nada de cards idênticos com a mesma sombra.

## Referências (leia antes de codar)

- `references/tokens.md` — cores OKLCH, tipografia, espaçamento, raios, motion, z-index.
- `references/components.md` — regras de cada componente e microinterações.
- `references/screens.md` — inventário de telas web e mobile, wireframes ASCII.

## 1. Princípios

1. **A resposta é a interface.** O conteúdo vem primeiro; o chrome desaparece.
   Citações inline `[1]` ancoram a afirmação no ponto em que ela é feita.
2. **Fontes são objetos de primeira classe.** Fonte não é rodapé — ela vive no
   painel lateral, com favicon, domínio, trecho e link.
3. **Uma assinatura: o Mission Trace.** Rail vertical que acende passo a passo
   (intenção → buscas paralelas → fontes lidas → síntese → artefato). Tudo ao
   redor dele permanece quieto e disciplinado.
4. **Restarição radical.** Sem gradiente como decoração, sem vidro, sem brilho.
   Profundidade vem de hairlines e camadas, não de sombra.
5. **A confiança é tipográfica.** Texto quente off-white sobre quase-preto
   azulado; peso máximo 550; serif opcional para respostas, sans para chrome.
6. **Clareza vale mais que o original.** Ações destrutivas nunca são o botão primário.
7. **Uma cor de marca.** Dourado nas ações primárias, no logo e no Mission Trace.
   Violeta e ciano têm papéis semânticos fixos — não são decoração.

## 2. Regra de acento (não negociar)

| Papel | Cor | Uso |
|---|---|---|
| Marca / primário | dourado metálico | CTA, logo, Missão Trace, foco forte |
| Raciocínio / agente | violeta | modo agente, blocos de raciocínio, Skill ativa |
| Ação ao vivo | ciano | streaming, "executando", status live, progresso |
| Confirmação | verde | tool_run concluído com sucesso |
| Alerta / falha | vermelho | erro, tool_run falhou, paywall urgente |

Uma tela não deve exibir mais de duas cores de acento simultaneamente. Escolha a
principal conforme a tarefa: **dourado** para ação do usuário, **violeta** para
raciocínio do agente, **ciano** para execução ao vivo.

## 3. Fundamentos (resumo)

- **Fundo:** `oklch(0.145 0.012 285)` base azul-violeta quase-preto.
- **Superfícies:** `base → surface → elevated → overlay`, passos de ~0.03 em L.
- **Bordas:** `1px solid oklch(1 0 0 / 8%)` padrão; `/14%` em hover; `/20%` ativo.
- **Dourado:** `oklch(0.82 0.135 82)` com gradiente metálico restrito ao logo e
  a superfícies de destaque — nunca em texto corrido de fundo escuro.
- **Texto:** primário `oklch(0.96 0.008 85)`, secundário `oklch(0.72 0.012 280)`,
  terciário `oklch(0.65 0.014 285)` no tema escuro para manter contraste AA.
- **Tipografia:** Geist (UI) / Geist Mono (código e saída de tool). Escala 12/13/14/15/17/20/28/40/64.
- **Raios:** 6 (chip) · 10 (input) · 14 (card) · 20 (painel) · 999 (pill).
- **Linha de leitura:** máx. 76 caracteres no texto de resposta.

## 4. Regras de motion

- Mensagem entra com **fade + blur(6px) → 0 + y:8px → 0**, 320ms, `easeOut`.
- Painéis entram em **cascata**, 40ms de atraso entre itens, nunca todos juntos.
- "KAZER está pensando" é um indicador **estruturado** (trilho + nós pulsando),
  não um spinner genérico.
- Microinterações: `transform` e `opacity` apenas, 120–200ms.
- Respeitar `prefers-reduced-motion`: sem transform, sem blur, opacity ≤ 100ms.

## 5. Acessibilidade (não negociável)

- Contraste AA mínimo em todo texto; texto terciário nunca abaixo de 4.5:1.
- Todo alvo de toque ≥ 44×44px (mobile) e ≥ 32×32px (web).
- Foco sempre visível: `outline: 2px solid var(--kazer-gold); outline-offset: 2px`.
- Todo controle icônico tem `aria-label`; todo painel tem `aria-label` e `role`.
- Navegação completa por teclado; `Esc` fecha modais e painéis; `⌘K` abre a busca.
- `aria-live="polite"` no região de streaming; `role="alert"` em erros.

## 6. Como usar esta skill

1. Leia `references/tokens.md` e copie os valores de lá — **não invente hex**.
2. Verifique `references/screens.md` para o layout da tela alvo.
3. Consulte `references/components.md` para as regras do componente.
4. Se web e mobile devem divergir, a divergência é de *layout*, nunca de *identidade*.
5. Ao adicionar um token novo, documente em `references/tokens.md` no mesmo commit.
