// Menu "/": digite "/" no campo de escrita e escolha uma das suas Skills.
//
// Funciona como o comando de barra do Claude: aparece uma lista das Skills
// ligadas, filtrada pelo que você digita depois da barra. Dá para clicar,
// tocar, ou usar as setas e Enter/Tab. Também dá para digitar o nome inteiro
// (`/revisor-de-codigo `) e, ao pôr o espaço, ele vira uma etiqueta.
//
// A lista vem do servidor e só traz Skills da própria conta. Escolher não
// escreve nada na mensagem: a Skill vira uma etiqueta acima do campo, e o envio
// leva o id dela — assim a Skill entra no contexto sempre, sem depender de
// palavra em comum com o que você escreveu.
//
// Baixado só no primeiro "/".

import { h, icon } from "./dom.js";
import { request } from "./net.js";

const MAX_ROWS = 6;
const FRESH_MS = 30_000;
// A barra vale no começo da mensagem ou depois de espaço/quebra de linha.
const TRIGGER = /(^|\s)\/([a-z0-9-]*)$/i;
const FULL = /(^|\s)\/([a-z0-9-]+)\s$/i;

export function createSlash({ textarea, host, onPick, onBrowse }) {
  const list = h("div.slash__list", { role: "listbox", id: "slash-list" });
  const menu = h("div.slash", { hidden: true, "aria-label": "Skills" }, list);
  host.append(menu);

  let skills = [];
  let fetchedAt = 0;
  let loading = null;
  let rows = [];
  let index = 0;
  let open = false;

  async function load() {
    if (Date.now() - fetchedAt < FRESH_MS) return skills;
    loading ||= request("/api/skills").then((result) => {
      loading = null;
      if (result.ok) {
        skills = (result.data.items || []).filter((item) => item.enabled);
        fetchedAt = Date.now();
      }
      return skills;
    });
    return loading;
  }

  // O texto antes do cursor decide se o menu está aberto e o que filtrar.
  function query() {
    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    const match = TRIGGER.exec(before);
    return match ? { text: match[2].toLowerCase(), start: before.length - match[2].length - 1 } : null;
  }

  function matches(text) {
    const starts = [];
    const contains = [];
    for (const skill of skills) {
      const slug = skill.slug || "";
      const name = skill.name.toLowerCase();
      if (!text || slug.startsWith(text) || name.startsWith(text)) starts.push(skill);
      else if (slug.includes(text) || name.includes(text) || skill.description.toLowerCase().includes(text)) contains.push(skill);
    }
    return [...starts, ...contains].slice(0, MAX_ROWS);
  }

  function paint() {
    const asked = query();
    if (!asked) return close();
    const found = matches(asked.text);
    rows = [];
    if (!found.length) {
      list.replaceChildren(
        skills.length
          ? h("p.slash__none", { text: "Nenhuma Skill com esse nome." })
          : h(
              "div.slash__none",
              {},
              h("p", { text: "Você ainda não tem Skills." }),
              h("button.slash__link", { type: "button", onclick: () => (close(), onBrowse?.()) }, "Ver o catálogo"),
            ),
      );
    } else {
      list.replaceChildren(...found.map((skill) => row(skill)));
    }
    index = 0;
    mark();
    menu.hidden = false;
    open = true;
    textarea.setAttribute("aria-expanded", "true");
    textarea.setAttribute("aria-controls", "slash-list");
  }

  function row(skill) {
    const node = h(
      "button.slash__row",
      {
        type: "button",
        role: "option",
        // `mousedown` e não `click`: o campo não pode perder o foco antes da escolha.
        onmousedown: (event) => {
          event.preventDefault();
          pick(skill);
        },
        onmousemove: () => {
          const at = rows.indexOf(node);
          if (at >= 0 && at !== index) {
            index = at;
            mark();
          }
        },
      },
      h("span.slash__glyph", {}, icon("sparkle")),
      h(
        "span.slash__text",
        {},
        h("span.slash__name", {}, h("span", { text: skill.name }), h("code.slash__slug", { text: `/${skill.slug}` })),
        h("span.slash__desc", { text: skill.description }),
      ),
    );
    node.dataset.id = skill.id;
    rows.push(node);
    return node;
  }

  function mark() {
    rows.forEach((node, at) => {
      node.classList.toggle("is-on", at === index);
      node.setAttribute("aria-selected", String(at === index));
      if (at === index) node.scrollIntoView({ block: "nearest" });
    });
  }

  function close() {
    if (!open && menu.hidden) return;
    open = false;
    menu.hidden = true;
    textarea.setAttribute("aria-expanded", "false");
  }

  // Tira a "/consulta" do texto e entrega a Skill escolhida.
  function pick(skill) {
    const asked = query();
    if (asked) {
      const end = textarea.selectionStart ?? textarea.value.length;
      const before = textarea.value.slice(0, asked.start).replace(/[ \t]+$/, "");
      const after = textarea.value.slice(end).replace(/^[ \t]+/, "");
      textarea.value = before && after ? `${before} ${after}` : before + after;
      const caret = before.length + (before && after ? 1 : 0);
      textarea.setSelectionRange(caret, caret);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    close();
    onPick(skill);
    textarea.focus();
  }

  // `/slug ` digitado por inteiro (com o espaço) vira etiqueta, se o nome for único.
  function autoConvert() {
    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    const match = FULL.exec(before);
    if (!match) return false;
    const found = skills.filter((skill) => skill.slug === match[2].toLowerCase());
    if (found.length !== 1) return false;
    const typed = `/${match[2]} `;
    const start = before.length - typed.length;
    const end = textarea.selectionStart ?? before.length;
    textarea.value = textarea.value.slice(0, start) + textarea.value.slice(end);
    textarea.setSelectionRange(start, start);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    onPick(found[0]);
    return true;
  }

  textarea.addEventListener("input", async () => {
    if (!query()) {
      // Sem barra no cursor: só confere se um comando inteiro acabou de ser digitado.
      close();
      if (/\/[a-z0-9-]+\s$/i.test(textarea.value.slice(0, textarea.selectionStart ?? 0))) {
        await load();
        autoConvert();
      }
      return;
    }
    await load();
    // A pessoa pode ter apagado a barra enquanto a lista chegava.
    if (query()) paint();
  });

  // Capture: roda antes do Enter que envia a mensagem.
  textarea.addEventListener(
    "keydown",
    (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!rows.length) return;
        event.preventDefault();
        index = (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        mark();
      } else if ((event.key === "Enter" || event.key === "Tab") && rows.length && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const chosen = skills.find((skill) => skill.id === rows[index]?.dataset.id);
        if (chosen) pick(chosen);
      }
    },
    true,
  );

  textarea.addEventListener("blur", () => window.setTimeout(close, 120));
  textarea.addEventListener("click", () => query() && paint());

  return {
    get open() {
      return open;
    },
    close,
    // Depois de criar ou instalar uma Skill, a lista precisa ser buscada de novo.
    refresh() {
      fetchedAt = 0;
    },
  };
}
