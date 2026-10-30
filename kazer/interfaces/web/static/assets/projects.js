// Tela Projetos: pastas de conversas em torno de um assunto.
//
// Baixada só quando a seção abre.

import { formatDate, h, icon } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";
import { emptyState, fab, headAction, searchField } from "./screens.js";

export async function createProjects({ onOpenConversation }) {
  const state = { archived: false, query: "" };
  const list = h("div.sc__list");
  const body = h("div.pr", {}, tabs(), list);

  function tabs() {
    const make = (archived, label) =>
      h(
        "button.sc__tab",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(state.archived === archived),
          dataset: { archived: String(archived) },
          onclick: () => {
            if (state.archived === archived) return;
            state.archived = archived;
            for (const chip of row.children) {
              chip.setAttribute("aria-selected", String(chip.dataset.archived === String(archived)));
            }
            load();
          },
        },
        h("span", { text: label }),
      );
    const row = h("div.sc__tabs", { role: "tablist", "aria-label": "Projetos" }, make(false, "Seus"), make(true, "Arquivados"));
    return row;
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.archived) query.set("archived", "1");
    if (state.query) query.set("q", state.query);
    const result = await request(`/api/projects?${query}`);
    if (!result.ok) {
      list.replaceChildren(emptyState({ glyph: "project", text: "Não deu para abrir os projetos agora." }));
      return;
    }
    const items = result.data.items;
    if (!items.length) {
      list.replaceChildren(
        emptyState({
          glyph: "project",
          text: state.archived
            ? "Nenhum projeto arquivado."
            : state.query
              ? "Nenhum projeto com esse nome."
              : "Crie um projeto para juntar as conversas do KAZER em torno de um assunto ou de um conjunto de documentos.",
        }),
      );
      return;
    }
    list.replaceChildren(...items.map(card));
  }

  function card(item) {
    const node = h(
      "button.sc__card",
      { type: "button", onclick: () => open(item) },
      h("span.sc__card-title", {}, icon("project"), h("span", { text: item.name })),
      item.goal ? h("span.sc__card-text", { text: item.goal }) : null,
      h("span.sc__card-meta", {
        text: `${item.conversations} conversa${item.conversations === 1 ? "" : "s"} · ${formatDate(item.updated_at)}`,
      }),
    );
    return node;
  }

  function open(item) {
    const rename = h("input.set-field__input", { type: "text", maxlength: "80", value: item.name, "aria-label": "Nome do projeto" });
    const goal = h("textarea.set-field__input.set-field__input--area", { rows: "3", maxlength: "2000", "aria-label": "Objetivo do projeto" });
    goal.value = item.goal || "";

    const save = async () => {
      const result = await request(`/api/projects/${item.id}`, {
        method: "POST",
        body: { name: rename.value.trim(), goal: goal.value.trim() },
      });
      if (!result.ok) {
        toast("Não deu para salvar agora.");
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      load();
    };

    openSheet({
      title: item.name,
      content: h(
        "div.pr__detail",
        {},
        h("label.set-field", {}, h("span.set-field__label", { text: "Nome" }), rename),
        h("label.set-field", {}, h("span.set-field__label", { text: "O que você quer realizar?" }), goal),
        h(
          "div.pr__actions",
          {},
          h("button.pill-button.pill-button--solid", { type: "button", onclick: save, text: "Salvar" }),
          h(
            "button.pill-button",
            {
              type: "button",
              text: item.archived ? "Desarquivar" : "Arquivar",
              onclick: async () => {
                await request(`/api/projects/${item.id}`, { method: "POST", body: { archived: !item.archived } });
                const { closeSheet } = await import("./sheets.js");
                await closeSheet();
                load();
              },
            },
          ),
          h(
            "button.set-link.set-link--quiet",
            {
              type: "button",
              onclick: async (event) => {
                const sure = await confirmDialog({
                  title: "Apagar o projeto?",
                  body: "As conversas dele continuam na sua conta, só ficam sem projeto.",
                  confirm: "Apagar",
                  danger: true,
                  opener: event.currentTarget,
                });
                if (!sure) return;
                await request(`/api/projects/${item.id}`, { method: "DELETE" });
                const { closeSheet } = await import("./sheets.js");
                await closeSheet();
                load();
              },
            },
            icon("trash"),
            h("span", { text: "Apagar projeto" }),
          ),
        ),
      ),
    });
  }

  function create() {
    const name = h("input.set-field__input", { type: "text", maxlength: "80", placeholder: "Dê um nome ao projeto", "aria-label": "Nome do projeto" });
    const goal = h("textarea.set-field__input.set-field__input--area", {
      rows: "3",
      maxlength: "2000",
      placeholder: "Descreva seu projeto, objetivos, assunto…",
      "aria-label": "Objetivo do projeto",
    });
    const submit = h("button.pill-button.pill-button--solid", { type: "button", text: "Criar projeto", disabled: true });
    name.addEventListener("input", () => {
      submit.disabled = !name.value.trim();
    });
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      const result = await request("/api/projects", {
        method: "POST",
        body: { name: name.value.trim(), goal: goal.value.trim() },
      });
      if (!result.ok) {
        toast(result.data?.error === "project_limit" ? "Você chegou ao limite de projetos." : "Não deu para criar agora.");
        submit.disabled = false;
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      state.archived = false;
      load();
    });

    openSheet({
      title: "Criar um projeto",
      content: h(
        "div.pr__detail",
        {},
        h("label.set-field", {}, h("span.set-field__label", { text: "No que você está trabalhando?" }), name),
        h("label.set-field", {}, h("span.set-field__label", { text: "O que você quer realizar?" }), goal),
        h("div.pr__actions", {}, submit),
      ),
    });
    window.setTimeout(() => name.focus(), 120);
  }

  await load();
  return {
    search: searchField({
      placeholder: "Pesquisar projetos",
      onInput: (value) => {
        state.query = value;
        load();
      },
    }),
    action: headAction({ label: "Recarregar", glyph: "retry", onClick: load }),
    body,
    fab: fab({ label: "Novo projeto", onClick: create }),
  };
}
