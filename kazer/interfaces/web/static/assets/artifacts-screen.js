// Tela Artefatos: só o que o KAZER produziu, separado do que você enviou.
//
// A Biblioteca junta as duas origens; aqui ficam as peças — páginas,
// componentes, SVG, diagramas, dados — com filtro por tipo.

import { formatBytes, formatDate, h, icon } from "./dom.js";
import { request } from "./net.js";
import { emptyState, headAction, searchField } from "./screens.js";

const TYPES = [
  ["", "Todos"],
  ["code", "Código"],
  ["document", "Documentos"],
  ["diagram", "Diagramas"],
  ["image", "Imagens"],
  ["data", "Dados"],
];

const GLYPHS = { code: "compose", document: "file", diagram: "research", image: "image", data: "sliders" };

export async function createArtifacts({ onOpenConversation }) {
  const state = { type: "", query: "", items: [], next: null, done: false, loading: false };
  const list = h("div.sc__list");
  const more = h("div.sc__more", { "aria-hidden": "true" });
  const body = h("div.ar", {}, tabs(), list, more);

  function tabs() {
    const make = ([id, label]) =>
      h(
        "button.sc__tab",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(state.type === id),
          dataset: { type: id },
          onclick: () => {
            if (state.type === id) return;
            state.type = id;
            for (const chip of row.children) chip.setAttribute("aria-selected", String(chip.dataset.type === id));
            render();
          },
        },
        h("span", { text: label }),
      );
    const row = h("div.sc__tabs", { role: "tablist", "aria-label": "Tipos de artefato" }, ...TYPES.map(make));
    return row;
  }

  // O servidor filtra por origem; o tipo e a busca são refinamentos locais
  // sobre as páginas já carregadas, que são poucas por definição.
  async function load({ reset = false } = {}) {
    if (state.loading || (state.done && !reset)) return;
    state.loading = true;
    if (reset) {
      state.items = [];
      state.next = null;
      state.done = false;
    }
    const query = new URLSearchParams({ kind: "artefato" });
    if (state.next) query.set("before", state.next);
    const result = await request(`/api/library?${query}`);
    state.loading = false;
    if (!result.ok) {
      state.done = true;
      render();
      return;
    }
    state.items = [...state.items, ...result.data.items];
    state.next = result.data.next || null;
    state.done = !result.data.has_more || !state.next;
    render();
    // Enquanto o filtro atual não tem nada e ainda há páginas, segue buscando.
    if (!state.done && !visible().length) load();
  }

  function visible() {
    const needle = state.query.toLowerCase();
    return state.items.filter(
      (item) =>
        (!state.type || item.kind === state.type) &&
        (!needle || (item.title || "").toLowerCase().includes(needle)),
    );
  }

  function render() {
    const items = visible();
    more.hidden = state.done;
    if (!items.length) {
      list.replaceChildren(
        emptyState({
          glyph: "layers",
          text: state.query || state.type
            ? "Nada com esse filtro."
            : "Os artefatos que você criar com o KAZER aparecem aqui.",
        }),
      );
      return;
    }
    list.replaceChildren(...items.map(card));
  }

  function card(item) {
    return h(
      "button.sc__card",
      {
        type: "button",
        onclick: async () => {
          const { openArtifactById } = await import("./library.js");
          openArtifactById(item.id, { onOpenConversation });
        },
      },
      h("span.sc__card-title", {}, icon(GLYPHS[item.kind] || "file"), h("span", { text: item.title })),
      h("span.sc__card-meta", {
        text: [item.language, item.size ? formatBytes(item.size) : "", formatDate(item.created_at)]
          .filter(Boolean)
          .join(" · "),
      }),
    );
  }

  // Carrega a próxima página quando o fim entra na tela.
  const sentinel = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  });
  sentinel.observe(more);

  // Resposta nova com artefatos: a lista se atualiza sozinha.
  window.addEventListener("kazer:artifacts", () => load({ reset: true }));

  await load({ reset: true });
  return {
    search: searchField({
      placeholder: "Pesquisar artefatos",
      onInput: (value) => {
        state.query = value;
        render();
      },
    }),
    action: headAction({ label: "Recarregar", glyph: "retry", onClick: () => load({ reset: true }) }),
    body,
  };
}
