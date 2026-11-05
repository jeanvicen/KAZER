// KZ Code: a oficina de código do KAZER.
//
// É a mesma conversa, com o modelo instruído a entregar arquivos inteiros em
// vez de trechos — o que alimenta a Biblioteca com artefatos de verdade. Quem
// decide se a pessoa pode usar é o servidor, pelo plano da conta.
//
// Duas caras, e nada no meio:
//   * plano pago: a tela de trabalho — descrever a tarefa, voltar para as
//     sessões recentes e conectar o computador (o terminal);
//   * plano gratuito: só a tela de compra, sem nenhuma meia-versão.
//
// Carregada só quando a aba abre.

import { formatDate, h, icon, loadStyle } from "./dom.js";
import { pixelWord } from "./pixel.js";
import { request } from "./net.js";

const PITCH = [
  ["Projetos completos em .zip", "Front, back e config em pastas organizadas. Baixa, extrai e roda."],
  ["Prévia ao vivo", "Sites, apps e jogos em HTML abrem funcionando na hora, no próprio chat."],
  ["Pesquisa enquanto programa", "Consulta a documentação atual e repositórios do GitHub antes de escrever."],
  ["Jogos com Godot 4", "No computador, peça um jogo com engine e receba o projeto pronto para importar."],
];

const IDEAS = [
  "Uma API de tarefas em Python com testes",
  "Uma página de preços responsiva em HTML e CSS",
  "Um script que renomeia fotos pela data",
];

export function createForja({ onStart, onOpenPlans, onOpenConversation, onOpenSettings } = {}) {
  const root = h("div.forja", { hidden: true });
  const state = { started: false, allowed: null };

  async function build() {
    const result = await request("/api/plans");
    // Sem resposta do servidor, a tela não finge que libera.
    state.allowed = result.ok ? Boolean(result.data.usage?.features?.coder) : false;
    const planName = result.ok ? result.data.usage?.plan_name || "KAZER" : "KAZER";
    const upgrade = result.ok ? result.data.plans?.find((plan) => plan.features?.coder) : null;
    root.replaceChildren(state.allowed ? ready() : locked(planName, upgrade));
  }

  function wordmark() {
    return h("h3.forja__word", {}, pixelWord("KZ CODE", { label: "KZ Code", blink: 3 }));
  }

  // ---------- Plano pago ----------

  function ready() {
    const area = h("textarea.forja__input", {
      rows: "3",
      maxlength: "4000",
      placeholder: "O que vamos construir?",
      "aria-label": "Descreva a tarefa",
    });
    const go = h(
      "button.forja__go",
      { type: "button", "aria-label": "Começar uma sessão", disabled: true },
      icon("arrow-up"),
    );
    const begin = () => {
      const text = area.value.trim();
      if (!text) return;
      onStart?.(text);
    };
    area.addEventListener("input", () => {
      go.disabled = !area.value.trim();
    });
    // Enter envia no computador; Shift+Enter pula linha. No celular, Enter pula.
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
        event.preventDefault();
        begin();
      }
    });
    go.addEventListener("click", begin);

    const sessions = h("div.forja__sessions", {}, h("p.forja__muted", { text: "Carregando sessões…" }));
    state.sessionsEl = sessions;
    loadSessions(sessions);

    return h(
      "div.forja__ready",
      {},
      h("div.forja__hero", {}, wordmark(), h("p.forja__lede", { text: "Descreva a tarefa. O KAZER devolve código pronto para rodar." })),
      h("div.forja__compose", {}, area, go),
      h(
        "div.forja__ideas",
        { "aria-label": "Ideias para começar" },
        IDEAS.map((idea) =>
          h("button.forja__idea", { type: "button", onclick: () => ((area.value = idea), (go.disabled = false), area.focus()) }, idea),
        ),
      ),
      h("section.forja__block", {}, h("h4.forja__h", { text: "Sessões recentes" }), sessions),
      computer(),
    );
  }

  async function loadSessions(target) {
    const result = await request("/api/code/sessions");
    if (!result.ok) {
      target.replaceChildren(h("p.forja__muted", { text: "Não deu para carregar as sessões agora." }));
      return;
    }
    const items = result.data.items || [];
    if (!items.length) {
      target.replaceChildren(h("p.forja__muted", { text: "Nenhuma sessão ainda. A primeira que você abrir aparece aqui." }));
      return;
    }
    target.replaceChildren(
      ...items.map((item) =>
        h(
          "button.forja__session",
          { type: "button", onclick: () => onOpenConversation?.(item.id) },
          icon("code", "forja__session-glyph"),
          h("span.forja__session-text", {}, h("span.forja__session-title", { text: item.title }), h("span.forja__session-when", { text: formatDate(item.updated_at) })),
          icon("chevron-right", "forja__session-go"),
        ),
      ),
    );
  }

  // O computador entra como o terminal do KAZER: mesma conta, mesmas sessões.
  function computer() {
    return h(
      "section.forja__block",
      {},
      h("h4.forja__h", { text: "Conectar seu computador" }),
      h(
        "div.forja__computer",
        {},
        icon("terminal", "forja__computer-glyph"),
        h(
          "span.forja__computer-text",
          {},
          h("strong", { text: "KZ Code no seu terminal" }),
          h("span", { text: "Mesma conta, mesmas conversas. Em um comando você entra e já está dentro." }),
        ),
        h(
          "button.forja__link",
          { type: "button", onclick: () => onOpenSettings?.("terminal") },
          h("span", { text: "Ver como" }),
        ),
      ),
    );
  }

  // ---------- Plano gratuito: só a compra ----------

  function locked(planName, upgrade) {
    const price = upgrade?.monthly_price || "";
    const daily = upgrade?.monthly_cents ? `${(upgrade.monthly_cents / 3000).toFixed(2).replace(".", ",")}` : "";
    const cta = h(
      "button.forja__start",
      { type: "button", onclick: (event) => onOpenPlans?.(event.currentTarget, upgrade?.id) },
      h("span.forja__start-shine", { "aria-hidden": "true" }),
      icon("bolt"),
      h("span", { text: upgrade ? `Destravar o KZ Code agora` : "Ver os planos" }),
    );
    // Terminal fake que "digita" um projeto saindo do zero: mostra o produto
    // funcionando antes de pedir o cartão.
    const lines = [
      ["$", "kz criar \"app de tarefas com login\""],
      ["›", "Plano: API + banco + tela, 6 arquivos"],
      ["✓", "app/main.py"],
      ["✓", "app/auth.py"],
      ["✓", "web/index.html"],
      ["›", "Pronto. Baixe o .zip e rode: python -m app"],
    ];
    const term = h(
      "div.forja__term",
      { "aria-hidden": "true" },
      h("div.forja__term-bar", {}, h("i"), h("i"), h("i"), h("span", { text: "kz code" })),
      h(
        "ol.forja__term-body",
        {},
        lines.map(([sign, text], index) => {
          const row = h("li", {}, h("b", { text: sign }), h("span", { text }));
          row.style.setProperty("--i", String(index));
          return row;
        }),
      ),
    );
    return h(
      "div.forja__locked",
      {},
      h("span.forja__aura", { "aria-hidden": "true" }),
      h(
        "div.forja__hero",
        {},
        h("span.forja__badge", {}, icon("bolt"), h("span", { text: "Exclusivo dos planos Pro e Ultra" })),
        wordmark(),
        h("p.forja__headline", { text: "Você descreve. O KAZER entrega o projeto inteiro." }),
        h("p.forja__lede", {
          text: "Pare de colar trecho por trecho. O KZ Code planeja, escreve todos os arquivos, testa a lógica e te entrega tudo organizado num .zip — pronto para rodar.",
        }),
      ),
      term,
      h("ul.forja__list", {}, PITCH.map(([title, text]) => item(title, text))),
      h(
        "div.forja__buy",
        {},
        cta,
        price
          ? h(
              "p.forja__price",
              {},
              h("strong", { text: price }),
              h("span", { text: daily ? ` por mês · menos de R$ ${daily} por dia` : " por mês" }),
            )
          : null,
        h("p.forja__trust", { text: "Cancele quando quiser · Sem fidelidade · Pagamento seguro" }),
      ),
      h("p.forja__note", { text: `Hoje você está no ${planName}.` }),
    );
  }

  function item(title, text) {
    return h(
      "li.forja__item",
      {},
      icon("check", "forja__check"),
      h("span", {}, h("strong", { text: title }), h("span", { text: ` ${text}` })),
    );
  }

  return {
    root,
    async show() {
      root.hidden = false;
      if (state.started) return;
      state.started = true;
      await loadStyle("/assets/forja.css");
      await build();
    },
    hide() {
      root.hidden = true;
    },
    // Ao voltar para a aba: com a tela de trabalho, só as sessões se atualizam
    // (o que a pessoa digitou fica); trancada, tudo se refaz para pegar um plano novo.
    refresh() {
      if (!state.started) return;
      if (state.allowed && state.sessionsEl?.isConnected) loadSessions(state.sessionsEl);
      else build();
    },
    get allowed() {
      return state.allowed;
    },
  };
}
