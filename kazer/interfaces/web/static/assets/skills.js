// Skills: o que você ensina ao KAZER, e o que a comunidade ensina.
//
// Uma Skill é nome, descrição e instruções — o mesmo formato de um SKILL.md. A
// descrição diz *quando* ela vale; as instruções, *como* responder. Chame uma
// Skill digitando "/" no campo de escrita.
//
// Três origens, e a tela diz qual é qual:
//   * Oficial: escrita pela equipe do KAZER, igual para todo mundo;
//   * Comunidade: publicada por outra pessoa. Passa por uma guarda de segurança,
//     entra no contexto como texto de terceiros e, quando está em uso, o KAZER
//     não escreve em nenhum serviço conectado;
//   * Sua: escrita por você.
//
// Instalar é copiar: a cópia fica congelada, então quem publicou não consegue
// trocar o texto depois do seu "instalar". Leia antes de instalar — a tela
// mostra o texto inteiro.

import { h, icon } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";
import { emptyState, fab, headAction, searchField } from "./screens.js";

const ERRORS = {
  skill_hidden_chars: "O texto tem caracteres invisíveis escondidos. Apague e digite de novo.",
  skill_limit: "Você chegou ao limite de Skills.",
  rate_limited: "Muitas publicações seguidas. Tente de novo daqui a pouco.",
  invalid_request: "Preencha nome, quando usar e instruções. O nome precisa ter letra ou número.",
  not_found: "Essa Skill não está mais aqui.",
  network: "Sem conexão. Tente de novo.",
};

// Motivos da guarda: a tela lista cada um, sem repetir o trecho que disparou.
function refusal(data) {
  if (data?.error === "skill_unsafe" && Array.isArray(data.reasons)) {
    return h(
      "div.sk__refusal",
      { role: "alert" },
      h("p.sk__refusal-title", { text: "Esta Skill não pode circular assim:" }),
      h("ul", {}, data.reasons.map((reason) => h("li", { text: reason }))),
      h("p.sk__refusal-note", {
        text: "Ela continua sua, para uso pessoal. Para publicar, tire esses trechos.",
      }),
    );
  }
  return null;
}

const messageFor = (data) => ERRORS[data?.error] || "Não deu para concluir agora.";

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
    const row = h("div.sc__tabs", { role: "tablist", "aria-label": "Skills" }, make("minhas", "Suas"), make("catalogo", "Catálogo"));
    return row;
  }

  async function load() {
    const mine = state.tab === "minhas";
    const query = new URLSearchParams();
    if (state.query) query.set("q", state.query);
    const result = await request(mine ? "/api/skills" : `/api/skills/shared?${query}`);
    if (!result.ok) {
      list.replaceChildren(emptyState({ glyph: "sparkle", text: "Não deu para abrir as Skills agora." }));
      return;
    }
    let items = result.data.items;
    if (mine && state.query) {
      const needle = state.query.toLowerCase();
      items = items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle));
    }
    note.textContent = mine
      ? 'Chame uma Skill digitando "/" no campo de escrita. O KAZER também usa uma quando as palavras da descrição aparecem no que você pede.'
      : "Skills oficiais e da comunidade. Leia o texto antes de instalar: instalar faz uma cópia sua, que ninguém altera depois.";
    if (!items.length) {
      list.replaceChildren(
        emptyState({
          glyph: "sparkle",
          text: mine
            ? "Nenhuma Skill ainda. Instale uma do catálogo ou crie a sua: dê um nome, diga quando ela vale e escreva as instruções."
            : "Nada no catálogo ainda.",
        }),
      );
      return;
    }
    list.replaceChildren(...items.map((item) => (mine ? ownCard(item) : sharedCard(item))));
  }

  const origin = (item) =>
    item.origin === "oficial"
      ? h("span.sk__tag.sk__tag--official", { text: "Oficial" })
      : item.origin === "comunidade"
        ? h("span.sk__tag.sk__tag--community", { text: "Comunidade" })
        : null;

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
          item.origin === "catalogo" ? h("span.sk__tag.sk__tag--community", { text: "Da comunidade" }) : null,
        ),
        h("span.sc__card-text", { text: item.description }),
        h("span.sk__slug", { text: `/${item.slug}` }),
      ),
      h("span.switch", {}, toggle, h("span.switch__track", { "aria-hidden": "true" }, h("span.switch__thumb"))),
    );
  }

  function sharedCard(item) {
    return h(
      "div.sc__card.sk__card",
      {},
      h(
        "button.sk__open",
        { type: "button", onclick: () => preview(item) },
        h("span.sc__card-title", {}, icon("sparkle"), h("span", { text: item.name }), origin(item)),
        h("span.sc__card-text", { text: item.description }),
      ),
      h("button.pill-button", { type: "button", text: "Ver", onclick: () => preview(item) }),
    );
  }

  // ---------- Ler antes de instalar ----------

  async function preview(item) {
    const full = await request(`/api/skills/shared/${item.id}`);
    if (!full.ok) {
      toast(messageFor(full.data));
      load();
      return;
    }
    const skill = full.data;
    const community = skill.origin === "comunidade";
    const install = h("button.pill-button.pill-button--solid", { type: "button", text: "Instalar" });
    install.addEventListener("click", async () => {
      install.disabled = true;
      const result = await request(`/api/skills/${item.id}/install`, { method: "POST" });
      install.disabled = false;
      if (!result.ok) {
        toast(messageFor(result.data));
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      toast(`${skill.name} instalada. Chame com /${result.data.slug}.`);
    });
    openSheet({
      title: skill.name,
      content: h(
        "div.sk__form",
        {},
        h("p.sk__lead", { text: skill.description }),
        community
          ? h("p.sk__warn", {
              text: "Escrita por outra pessoa. O KAZER trata como texto de terceiros e, com ela em uso, não escreve em serviços conectados. Mesmo assim, leia antes de instalar.",
            })
          : h("p.sk__lead", { text: "Escrita pela equipe do KAZER." }),
        h("pre.sk__text", { tabindex: "0" }, h("code", { text: skill.instructions })),
        h("div.sk__actions", {}, install),
      ),
    });
  }

  // ---------- Formulário ----------

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
      toast(messageFor(full.data));
      return;
    }
    const fields = form(full.data);
    const slot = h("div.sk__slot");
    const save = h("button.pill-button.pill-button--solid", { type: "button", text: "Salvar" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      slot.replaceChildren();
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
        slot.replaceChildren(refusal(result.data) || h("p.sk__warn", { text: messageFor(result.data) }));
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      load();
    });

    const publish = h("button.pill-button", { type: "button", text: full.data.shared ? "Despublicar" : "Publicar para a comunidade" });
    publish.addEventListener("click", async () => {
      slot.replaceChildren();
      publish.disabled = true;
      const result = await request(`/api/skills/${item.id}`, { method: "POST", body: { shared: !full.data.shared } });
      publish.disabled = false;
      if (!result.ok) {
        slot.replaceChildren(refusal(result.data) || h("p.sk__warn", { text: messageFor(result.data) }));
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      toast(full.data.shared ? "Skill despublicada." : "Skill publicada para a comunidade.");
      load();
    });

    const community = full.data.origin === "catalogo";
    openSheet({
      title: item.name,
      content: h(
        "div.sk__form",
        {},
        community ? h("p.sk__warn", { text: "Veio da comunidade: o KAZER a trata como texto de terceiros." }) : null,
        field("Nome", fields.name),
        field("Quando usar", fields.description),
        field("Instruções", fields.instructions),
        slot,
        h(
          "div.sk__actions",
          {},
          save,
          community ? null : publish,
          h(
            "button.set-link.set-link--quiet",
            {
              type: "button",
              onclick: async (event) => {
                const sure = await confirmDialog({
                  title: "Apagar a Skill?",
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
    const slot = h("div.sk__slot");
    const submit = h("button.pill-button.pill-button--solid", { type: "button", text: "Criar Skill", disabled: true });
    const check = () => {
      submit.disabled = !(fields.name.value.trim() && fields.description.value.trim() && fields.instructions.value.trim());
    };
    for (const input of Object.values(fields)) input.addEventListener("input", check);
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      slot.replaceChildren();
      const result = await request("/api/skills", {
        method: "POST",
        body: {
          name: fields.name.value.trim(),
          description: fields.description.value.trim(),
          instructions: fields.instructions.value.trim(),
        },
      });
      if (!result.ok) {
        slot.replaceChildren(h("p.sk__warn", { text: messageFor(result.data) }));
        submit.disabled = false;
        return;
      }
      const { closeSheet } = await import("./sheets.js");
      await closeSheet();
      state.tab = "minhas";
      load();
    });
    openSheet({
      title: "Nova Skill",
      content: h(
        "div.sk__form",
        {},
        h("p.sk__lead", { text: "Dê um nome, diga quando ela vale e escreva como o KAZER deve responder. O nome vira o comando: /nome." }),
        field("Nome", fields.name),
        field("Quando usar", fields.description),
        field("Instruções", fields.instructions),
        slot,
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
      placeholder: "Pesquisar Skills",
      onInput: (value) => {
        state.query = value;
        load();
      },
    }),
    action: headAction({ label: "Recarregar", glyph: "retry", onClick: load }),
    body,
    fab: fab({ label: "Nova Skill", onClick: create }),
  };
}
