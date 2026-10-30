// Telas cheias do KAZER: Projetos, Forja, Artefatos, Biblioteca e Habilidades.
//
// Cada seção da gaveta abre uma tela própria, com o mesmo esqueleto: cabeçalho
// com o menu à esquerda, título no meio e a ação da tela à direita; busca;
// conteúdo; e um botão flutuante quando há algo para criar.
//
// Baixada só quando a pessoa sai das Conversas: quem só conversa não paga por
// nada disto.

import { h, icon, loadStyle } from "./dom.js";

const TITLES = {
  projetos: "Projetos",
  forja: "Forja",
  artefatos: "Artefatos",
  biblioteca: "Biblioteca",
  habilidades: "Habilidades",
};

export function createScreens({ host, onMenu, onOpenConversation, onStartForja, onOpenPlans }) {
  const current = { name: "", view: null };
  const cache = new Map();

  function shell(name, { action = null, search = null, body, fab = null } = {}) {
    return h(
      "div.sc",
      { dataset: { screen: name } },
      h(
        "header.sc__head",
        {},
        h(
          "button.icon-button.sc__menu",
          { type: "button", "aria-label": "Abrir menu", onclick: () => onMenu?.() },
          icon("menu"),
        ),
        h("h2.sc__title", { text: TITLES[name] || name }),
        action || h("span.sc__slot", { "aria-hidden": "true" }),
      ),
      search,
      h("div.sc__body", {}, body),
      fab,
    );
  }

  async function build(name) {
    if (name === "biblioteca") {
      const { createLibrary } = await import("./library.js");
      const library = createLibrary({ onOpenConversation });
      library.root.hidden = false;
      library.show();
      return shell(name, { body: library.root });
    }
    if (name === "forja") {
      const { createForja } = await import("./forja.js");
      const forja = createForja({ onStart: onStartForja, onOpenPlans });
      forja.root.hidden = false;
      forja.show();
      return shell(name, { body: forja.root });
    }
    if (name === "artefatos") {
      const { createArtifacts } = await import("./artifacts-screen.js");
      return shell(name, await createArtifacts({ onOpenConversation }));
    }
    if (name === "projetos") {
      const { createProjects } = await import("./projects.js");
      return shell(name, await createProjects({ onOpenConversation }));
    }
    if (name === "habilidades") {
      const { createSkills } = await import("./skills.js");
      return shell(name, await createSkills());
    }
    return shell(name, { body: h("p.sc__empty", { text: "Em breve." }) });
  }

  return {
    async open(name) {
      if (current.name === name) return;
      await loadStyle("/assets/screens.css");
      let view = cache.get(name);
      if (!view) {
        view = await build(name);
        cache.set(name, view);
      }
      host.replaceChildren(view);
      host.hidden = false;
      current.name = name;
      current.view = view;
      // O foco vai para o título: quem usa teclado ou leitor sabe que mudou.
      view.querySelector(".sc__title")?.focus?.();
      view.querySelector(".sc__refresh")?.click?.();
    },
    close() {
      host.hidden = true;
      host.replaceChildren();
      current.name = "";
      current.view = null;
    },
    get name() {
      return current.name;
    },
  };
}

// ---------- Peças que as telas compartilham ----------

export function searchField({ placeholder, onInput, delay = 260 }) {
  const input = h("input.sc__search-input", {
    type: "search",
    placeholder,
    "aria-label": placeholder,
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "80",
  });
  let timer = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onInput(input.value.trim()), delay);
  });
  return h("label.sc__search", {}, icon("search"), input);
}

export function emptyState({ glyph, text, action = null }) {
  return h(
    "div.sc__empty",
    {},
    h("span.sc__empty-glyph", { "aria-hidden": "true" }, icon(glyph)),
    h("p.sc__empty-text", { text }),
    action,
  );
}

export function fab({ label, onClick }) {
  return h("button.sc__fab", { type: "button", onclick: onClick }, icon("plus"), h("span", { text: label }));
}

export function headAction({ label, glyph, onClick }) {
  return h(
    "button.icon-button.sc__action",
    { type: "button", "aria-label": label, onclick: onClick },
    icon(glyph),
  );
}
