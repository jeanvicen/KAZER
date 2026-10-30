// Tela Habilidades: o que você ensina ao KAZER.
//
// Uma habilidade é nome, descrição e instruções — o mesmo formato de um
// SKILL.md. A descrição é o que decide quando ela entra: o KAZER compara as
// palavras dela com o que você escreveu e, quando batem, segue as instruções.
//
// Qualquer pessoa cria a sua e pode publicar no catálogo; instalar é copiar,
// então mexer na sua cópia não altera a de ninguém.

import { h, icon } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";
import { emptyState, fab, headAction, searchField } from "./screens.js";

export async function createSkills() {
  const state = { tab: "minhas", query: "" };
  const list = h("div.sc__list");
  const note = h("p.sk__note");
  const body = h("div.sk", {}, tabs(), note, list);

  function tabs() {
    const make = (id, label) =>
      h(
        "button.sc__tab",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(state.tab === id),
          dataset: { tab: id },
          onclick: () => {
            if (state.tab === id) return;
            state.tab = id;
            for (const chip of row.children) chip.setAttribute("aria-selected", String(chip.dataset.tab === id));
            load();
          },
        },
        h("span", { text: label }),
      );
    const row = h("div.sc__tabs", { role: "tablist", "aria-label": "Habilidades" }, make("minhas", "Suas"), make("catalogo", "Catálogo"));
    return row;
  }

  async function load() {
    const mine = state.tab === "minhas";
    const query = new URLSearchParams();
    if (state.query) query.set("q", state.query);
    const result = await request(mine ? "/api/skills" : `/api/skills/shared?${query}`);
    if (!result.ok) {
      list.replaceChildren(emptyState({ glyph: "sparkle", text: "Não deu para abrir as habilidades agora." }));
      return;
    }
    let items = result.data.items;
    if (mine && state.query) {
      const needle = state.query.toLowerCase();
      items = items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle));
    }
    note.textContent = mine
      ? "O KAZER usa uma habilidade quando as palavras da descrição aparecem no que você pede."
      : "Habilidades publicadas por quem usa o KAZER. Instalar faz uma cópia sua.";
    if (!items.length) {
      list.replaceChildren(
        emptyState({
          glyph: "sparkle",
          text: mine
            ? "Nenhuma habilidade ainda. Crie uma: dê um nome, diga quando ela vale e escreva as instruções."
            : "Nada publicado no catálogo ainda. Publique a sua e ela aparece aqui para todo mundo.",
        }),
      );
      return;
    }
    list.replaceChildren(...items.map((item) => (mine ? ownCard(item) : sharedCard(item))));
  }

  function ownCard(item) {
    const toggle = h("input.switch__input", {
      type: "checkbox",
      role: "switch",
      checked: item.enabled,
      "aria-label": `Ligar ${item.name}`,
    });
    toggle.addEventListener("click", (event) => event.stopPropagation());
    toggle.addEventListener("change", async () => {
      const result = await request(`/api/skills/${item.id}`, { method: "POST", body: { enabled: toggle.checked } });
      if (!result.ok) {
        toggle.checked = !toggle.checked;
        toast("Não deu para mudar agora.");
      }
    });
    return h(
      "div.sc__card.sk__card",
      {},
      h(
        "button.sk__open",
        { type: "button", onclick: () => edit(item) },
        h(
          "span.sc__card-title",
          {},
          icon("sparkle"),
          h("span", { text: item.name }),
          item.shared ? h("span.sk__tag", { text: "Publicada" }) : null,
          item.origin === "catalogo" ? h("span.sk__tag", { text: "Do catálogo" }) : null,
        ),
        h("span.sc__card-text", { text: item.description }),
      ),
      h("span.switch", {}, toggle, h("span.switch__track", { "aria-hidden": "true" }, h("span.switch__thumb"))),
    );
  }

  function sharedCard(item) {
    return h(
      "div.sc__card.sk__card",
      {},
      h(
        "span.sk__open",
        {},
        h("span.sc__card-title", {}, icon("sparkle"), h("span", { text: item.name })),
        h("span.sc__card-text", { text: item.description }),
      ),
      h(
        "button.pill-button",
        {
          type: "button",
          text: "Instalar",
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            const result = await request(`/api/skills/${item.id}/install`, { method: "POST" });
            button.disabled = false;
            if (!result.ok) {
              toast(result.data?.error === "skill_limit" ? "Você chegou ao limite de habilidades." : "Não deu para instalar agora.");
              return;
            }
            toast(`${item.name} instalada.`);
          },
        },
      ),
    );
  }

  function form(item) {
    const name = h("input.set-field__input", { type: "text", maxlength: "60", placeholder: "Ex.: Revisor de contratos", "aria-label": "Nome" });
    const description = h("input.set-field__input", {
      type: "text",
      maxlength: "300",
      placeholder: "Quando o KAZER deve usar isto",
      "aria-label": "Quando usar",
    });
    const instructions = h("textarea.set-field__input.set-field__input--area", {
      rows: "9",
      maxlength: "20000",
      placeholder: "Escreva as instruções que o KAZER deve seguir.",
      "aria-label": "Instruções",
    });
    if (item) {
      name.value = item.name;
      description.value = item.description;
      instructions.value = item.instructions || "";
    }
    return { name, description, instructions };
  }

  async function edit(item) {
    const full = await request(`/api/skills/${item.id}`);
    if (!full.ok) {
      toast("Essa habilidade não está mais aqui.");
      return;
    }
    const fields = form(full.data);
    const save = h("button.pill-button.pill-button--solid", { type: "button", text: "Salvar" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      const result = await request(`/api/skills/${item.id}`, {
        method: "POST",
        body: {
          name: fields.name.value.trim(),
          description: fields.description.value.trim(),
          instructions: fields.instructions.value.trim(),
        },
      });
      save.disabled = false;
      if (!result.ok) {
        toast("Preencha nome, descrição e instruções.");
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      load();
    });

    const publish = h("button.pill-button", { type: "button", text: full.data.shared ? "Despublicar" : "Publicar no catálogo" });
    publish.addEventListener("click", async () => {
      await request(`/api/skills/${item.id}`, { method: "POST", body: { shared: !full.data.shared } });
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      load();
    });

    openSheet({
      title: item.name,
      content: h(
        "div.sk__form",
        {},
        field("Nome", fields.name),
        field("Quando usar", fields.description),
        field("Instruções", fields.instructions),
        h(
          "div.sk__actions",
          {},
          save,
          publish,
          h(
            "button.set-link.set-link--quiet",
            {
              type: "button",
              onclick: async (event) => {
                const sure = await confirmDialog({
                  title: "Apagar a habilidade?",
                  body: "O KAZER para de usá-la nesta conta.",
                  confirm: "Apagar",
                  danger: true,
                  opener: event.currentTarget,
                });
                if (!sure) return;
                await request(`/api/skills/${item.id}`, { method: "DELETE" });
                const { closeSheet } = await import("./sheets.js");
                await closeSheet();
                load();
              },
            },
            icon("trash"),
            h("span", { text: "Apagar" }),
          ),
        ),
      ),
    });
  }

  function create() {
    const fields = form(null);
    const submit = h("button.pill-button.pill-button--solid", { type: "button", text: "Criar habilidade", disabled: true });
    const check = () => {
      submit.disabled = !(fields.name.value.trim() && fields.description.value.trim() && fields.instructions.value.trim());
    };
    for (const input of Object.values(fields)) input.addEventListener("input", check);
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      const result = await request("/api/skills", {
        method: "POST",
        body: {
          name: fields.name.value.trim(),
          description: fields.description.value.trim(),
          instructions: fields.instructions.value.trim(),
        },
      });
      if (!result.ok) {
        toast(result.data?.error === "skill_limit" ? "Você chegou ao limite de habilidades." : "Não deu para criar agora.");
        submit.disabled = false;
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      state.tab = "minhas";
      load();
    });

    openSheet({
      title: "Nova habilidade",
      content: h(
        "div.sk__form",
        {},
        h("p.sk__hint", { text: "A descrição decide quando ela vale: escreva as palavras que você usaria ao pedir." }),
        field("Nome", fields.name),
        field("Quando usar", fields.description),
        field("Instruções", fields.instructions),
        h("div.sk__actions", {}, submit),
      ),
    });
    window.setTimeout(() => fields.name.focus(), 120);
  }

  function field(label, input) {
    return h("label.set-field", {}, h("span.set-field__label", { text: label }), input);
  }

  await load();
  return {
    search: searchField({
      placeholder: "Pesquisar habilidades",
      onInput: (value) => {
        state.query = value;
        load();
      },
    }),
    action: headAction({ label: "Recarregar", glyph: "retry", onClick: load }),
    body,
    fab: fab({ label: "Nova habilidade", onClick: create }),
  };
}
