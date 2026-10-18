# KAZER — Inventário de Telas

ASCII wireframes de referência. A estrutura (nomes, ordem, hierarquia) é
obrigatória; o pixel final vem dos tokens.

## WEB

### `/` — Landing

```
┌────────────────────────────────────────────────────────────┐
│  ◆ KAZER           .produto  planos  skills      [Entrar] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│         (anel dourado, breathing)                          │
│          Pergunte. O KAZER executa.                        │
│    IA de pesquisa, execução e criação.                    │
│                                                            │
│   ┌────────────────────────────────────────────┐           │
│   │ ▌ Pergunte. O KAZER executa.          ⏎   │  ← demo  │
│   └────────────────────────────────────────────┘           │
│                                                            │
│   [ ▸ 4 buscas em paralelo ] [ ● 7 fontes ] [ ◆ artefato ]│
│                                                            │
│      ┌──── painel de demo ao vivo ────┐                    │
│      │ Mission Trace animando          │                    │
│      │ resposta com citações [1][2]    │                    │
│      └─────────────────────────────────┘                    │
│                                                            │
│   ── O que o KAZER faz ──   (3 blocos, sem card igual)     │
│   ── Como funciona ──       (4 passos numerados)           │
│   ── Planos teaser ──       (Free / Pro / MAX)             │
│   ── Perguntas frequentes ──                               │
│                                                            │
│  ◆ KAZER        © 2026  Privacidade  Termos   pt-BR       │
└────────────────────────────────────────────────────────────┘
```

Regras: hero com demo **vivo** (o Mission Trace roda de verdade), sem blob de
gradiente, sem eyebrow em tudo. Um único CTA primário por dobra.

### `/login` · `/signup`

```
┌──────────────────────────────┬────────────────────────────┐
│                              │      Entrar no KAZER       │
│   (coluna de marca,          │      ┌────────────────┐     │
│    logo dourado,             │      │ e-mail         │     │
│    linha de marca,           │      └────────────────┘     │
│    citação curta)            │      ┌────────────────┐     │
│                              │      │ senha          │     │
│                              │      └────────────────┘     │
│                              │      [ Entrar ]            │
│                              │      ── ou ──              │
│                              │      [ G  Continuar com Google]│
│                              │      esqueci a senha       │
│                              │      Não tem conta? CADASTRE│
└──────────────────────────────┴────────────────────────────┘
```

### `/onboarding` — 4 passos

Passo 1 idioma (pt-BR / en-US / es-ES) · passo 2 tema (dark/light/system) ·
passo 3 modelo padrão (cards de modelo) · passo 4 primeiro agente (5 Skills
com ícone). Barra de progresso no topo, botão "Pular" e "Voltar".

### `/kazer` — Workspace (shell de 3 colunas)

```
┌──────────────┬─────────────────────────────┬───────────────┐
│ ◆ KAZER      │  ▓ novo · conversa ▓        │ Fontes│Artef.│Exe.│
│ [+ Nova miss.]│  ─────────────────────────  ├───────────────┤
│ 🔍 buscar    │                             │ 5 fontes      │
│              │  pergunta do usuário        │ ┌───────────┐ │
│ HOJE         │  ▌bloco de resposta         │ │ favicon   │ │
│  · Pesquisa… │  │                          │ │ título    │ │
│  · Pricing…  │  │ ● Intenção entendida      │ │ trecho    │ │
│ ONTEM        │  │ ● 4 buscas em paralelo    │ └───────────┘ │
│  · Contrato… │  │ ○ Síntese                 │               │
│ ÚLT. 7 DIAS  │  │                          │               │
│ ANTERIORES   │  │ resposta com [1] [2]      │               │
│              │  │                          │               │
│ ─────────    │  [ continuar? ] chips       │               │
│ Skills · Docs│ ┌─────────────────────────┐ │               │
│ ⚙ Config     │ │ textarea    modelo ⌄  ⏎ │ │               │
└──────────────┴─────────────────────────────┴───────────────┘
        264px              flex, 720px máx            340px
```

- Sidebar: busca (⌘K), botão "Nova missão", grupos **Hoje · Ontem · Últimos 7
  dias · Anteriores**, cada item com hover revealing pin/archive/delete.
- Topo do chat: título da conversa + ações (renomear, fixar, arquivar,
  exportar, excluir) no menu `⋯`.
- Painel direito: 3 tabs — **Fontes** · **Artefatos** · **Execução**. Em telas
  < 1280px vira bottom sheet acionado por chips no topo do chat.
- Estado vazio do chat: marca + "O que o KAZER pode fazer por você" + 4
  cartões de missão sugerida (Pesquisa, Relatório, Código, Estratégia) +
  as 5 Skills.

### `/kazer/chat/[id]` — Conversa
Mesma shell, conteúdo = thread. Cada turno: pergunta do usuário, resposta do
agente com Mission Trace, follow-ups, ações.

### `/kazer/research` — Research
Mesma shell, mas forçado ao modo Research. Extras: no topo da resposta, linha
de "12 resultados lidos · 5 citados"; a aba Fontes vem pré-selecionada; chips
de query usada ("queries que o KAZER rodou").

### `/kazer/agents` — Biblioteca de Skills
Grid de cards: ícone, nome, descrição, versão, tags, permissões pedidas
(leitura de web, escrita de arquivo, shell), botão ativar/desativar.
Filtro por tag. Estado vazio com CTA "Criar Skill".

### `/kazer/artifacts`
Grid de artefatos com filtro por tipo (documento, planilha, código, landing,
relatório, imagem), preview, download, compartilhamento, badge de versão.
Empty state elegante.

### `/kazer/pricing`
3 colunas: Free (R$ 0) · Pro · **KAZER MAX** (destaque, borda dourada, anel
metálico no topo, badge "Recomendado"). Tabela comparativa. FAQ em accordion.
Botões: "Começar grátis" · "Assinar Pro" · "Ativar KAZER MAX".

### `/kazer/settings`
Tabs: Perfil · Modelos · Chaves de API · Tema · Assinatura · Notificações ·
Dados. Formulários com validação inline e estados de sucesso discretos.

### `/admin`
Métricas (usuários ativos, MRR, tokens, execuções), tabela de usuários com
busca e filtro de plano, uso por skill, alertas do sistema.

## MOBILE

```
Splash          Animate a marca dourada + "Pergunte. O KAZER executa." (2s)
Onboarding      3 telas: missões · fontes verificáveis · artefatos prontos
Login/Signup    Stacked, marca no topo, botão Google
Home            Logo + barra de pesquisa grande (estilo Perplexity) +
                4 chips de missão + 3 conversas recentes
Chat            Mensagens, Mission Trace vertical, composer fixo acima do teclado
Drawer          Histórico deslizante (left), grupos por data
Research detail Resposta + abas Resumo/Fontes + lista de sources
Agents          Lista vertical de Skills com toggle
Artifacts       Grid 2 col + preview modal + share sheet
Settings        Perfil, assinatura, tema, modelos, sair
```

Regras mobile:
- Safe area: `paddingTop` no topo com `env(safe-area-inset-top)`,
  `paddingBottom` no composer com `env(safe-area-inset-bottom)`.
- Topo acima do Dynamic Island: nenhuma informação crítica na faixa de 44px.
- Bottom sheet com 3 detentes: 25% (peek), 60% (half), 92% (full).
- Gesto de arrastar para fechar, com `snap` points.
- Alvos de toque ≥ 44×44px.
- Keyboard avoidance via `KeyboardAvoidingView` + `keyboardVerticalOffset`.
