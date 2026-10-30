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
  ["Arquivos inteiros", "Nada de trecho solto: cada arquivo vem com nome, pronto para colar no projeto."],
  ["Vai para a Biblioteca", "Tudo o que o KZ Code produz fica guardado, com copiar e baixar."],
  ["Plano antes do código", "O KAZER diz o que vai fazer, entrega, e depois explica como rodar."],
  ["Pergunta em vez de inventar", "Decisão que só você pode tomar vira pergunta, não chute."],
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
    const price = upgrade?.monthly_price ? `${upgrade.monthly_price} por mês` : "";
    return h(
      "div.forja__locked",
      {},
      h("div.forja__hero", {}, wordmark(), h("p.forja__lede", { text: "A oficina de código do KAZER. Ela entra com os planos pagos." })),
      h("ul.forja__list", {}, PITCH.map(([title, text]) => item(title, text))),
      h(
        "button.forja__start",
        {
          type: "button",
          onclick: (event) => onOpenPlans?.(event.currentTarget, upgrade?.id),
        },
        icon("bolt"),
        h("span", { text: upgrade ? `Destravar com o ${upgrade.name}` : "Ver os planos" }),
      ),
      price ? h("p.forja__price", { text: price }) : null,
      h("p.forja__note", { text: `Você está no ${planName}.` }),
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
