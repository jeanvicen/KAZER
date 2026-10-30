// Forja: a oficina de código do KAZER.
//
// É a mesma conversa, com o modelo instruído a entregar arquivos inteiros em
// vez de trechos — o que alimenta a Biblioteca com artefatos de verdade. Quem
// decide se a pessoa pode usar é o servidor, pelo plano da conta; esta tela só
// mostra o estado e, quando está trancada, explica o que a Forja faz.
//
// Carregada só quando a aba abre.

import { h, icon, loadStyle, mark } from "./dom.js";
import { request } from "./net.js";

const PITCH = [
  ["Arquivos inteiros", "Nada de trecho solto: cada arquivo vem com nome, pronto para colar no projeto."],
  ["Vai para a Biblioteca", "Tudo o que a Forja produz fica guardado, com copiar e baixar."],
  ["Plano antes do código", "O KAZER diz o que vai fazer, entrega, e depois explica como rodar."],
  ["Pergunta em vez de inventar", "Decisão que só você pode tomar vira pergunta, não chute."],
];

export function createForja({ onStart, onOpenPlans } = {}) {
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

  function stage() {
    // A Fenda batendo o martelo: aparece de vez em quando, não o tempo todo.
    return h(
      "div.forja__stage",
      { "aria-hidden": "true" },
      h("span.forja__anvil"),
      h("span.forja__spark"),
      h("span.forja__spark.forja__spark--b"),
      h("span.forja__spark.forja__spark--c"),
      mark("forja__mark"),
    );
  }

  function ready() {
    return h(
      "div.forja__ready",
      {},
      stage(),
      h("h3.forja__title", { text: "Forja" }),
      h("p.forja__lede", { text: "Peça um projeto, um arquivo ou uma correção. O KAZER devolve código pronto para rodar." }),
      h(
        "button.forja__start",
        { type: "button", onclick: () => onStart?.() },
        icon("compose"),
        h("span", { text: "Abrir a Forja" }),
      ),
      h("ul.forja__list", {}, PITCH.map(([title, text]) => item(title, text))),
    );
  }

  function locked(planName, upgrade) {
    return h(
      "div.forja__locked",
      {},
      stage(),
      h("h3.forja__title", {}, "Forja", h("span.forja__lock", {}, icon("lock"))),
      h("p.forja__lede", { text: "A oficina de código do KAZER. Ela entra com os planos pagos." }),
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
    // Depois de uma troca de plano, a tela precisa refletir a verdade nova.
    refresh() {
      if (state.started) build();
    },
    get allowed() {
      return state.allowed;
    },
  };
}
