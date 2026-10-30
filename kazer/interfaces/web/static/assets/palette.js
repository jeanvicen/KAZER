// Paleta de comandos: a habilidade que só o computador tem.
//
// Ctrl+K (⌘K no Mac) abre uma caixa que faz tudo pelo teclado — ir para uma
// seção, começar uma conversa, abrir o KZ Code ou as configurações, e buscar
// entre as conversas sem tirar a mão do teclado. No celular ela não existe:
// lá a gaveta já está a um toque e não há teclado físico para atalho.
//
// Baixada no primeiro Ctrl+K: quem nunca usa não paga por ela.

import { announce, h, icon, loadStyle, reducedMotion, trapFocus } from "./dom.js";
import { request } from "./net.js";

let current = null;
const BUSCA_MS = 220;
const MAX_CONVERSAS = 6;

export function paletteOpen() {
  return current !== null;
}

export function closePalette() {
  current?.close();
}

/**
 * Abre a paleta. `groups` são as ações, em grupos, vindas de quem chamou:
 * a paleta não conhece o app, só executa o que recebe.
 */
export async function openPalette({ groups, onOpenConversation, opener = document.activeElement }) {
  if (current) return current;
  await loadStyle("/assets/palette.css");
  current = new Palette({ groups, onOpenConversation, opener });
  return current;
}

class Palette {
  constructor({ groups, onOpenConversation, opener }) {
    this.groups = groups;
    this.onOpenConversation = onOpenConversation;
    this.opener = opener;
    this.rows = [];
    this.index = 0;
    this.timer = 0;
    this.token = 0;
    this.build();
  }

  build() {
    this.input = h("input.pal__input", {
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Buscar conversa ou comando",
      "aria-label": "Buscar conversa ou comando",
      "aria-controls": "pal-list",
      oninput: () => this.onType(),
    });
    this.list = h("div.pal__list", { id: "pal-list", role: "listbox" });
    this.panel = h(
      "div.pal",
      { role: "dialog", "aria-modal": "true", "aria-label": "Comandos", tabindex: "-1" },
      h("div.pal__field", {}, icon("search", "pal__glyph"), this.input),
      this.list,
      h(
        "footer.pal__foot",
        {},
        hint("↑↓", "navegar"),
        hint("Enter", "abrir"),
        hint("Esc", "fechar"),
      ),
    );
    this.scrim = h("div.pal__scrim", { onclick: () => this.close() });
    this.root = h("div.pal__layer", {}, this.scrim, this.panel);

    this.onKey = (event) => this.key(event);
    document.addEventListener("keydown", this.onKey, true);
    document.body.append(this.root);
    const chat = document.getElementById("chat");
    if (chat) chat.inert = true;
    this.render([]);
    window.requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.input.focus({ preventScroll: true });
    });
  }

  // ---------- Conteúdo ----------

  onType() {
    const query = this.input.value.trim();
    this.render([]);
    window.clearTimeout(this.timer);
    if (query.length < 2) return;
    this.timer = window.setTimeout(() => this.search(query), BUSCA_MS);
  }

  async search(query) {
    const token = ++this.token;
    const result = await request(`/api/conversations?q=${encodeURIComponent(query)}`);
    // Resposta de uma busca antiga não pode sobrescrever a atual.
    if (token !== this.token || !current) return;
    const items = result.ok && Array.isArray(result.data?.items) ? result.data.items : [];
    this.render(items.slice(0, MAX_CONVERSAS));
  }

  matches(action, query) {
    if (!query) return true;
    return `${action.label} ${action.about || ""}`.toLowerCase().includes(query);
  }

  render(conversations) {
    const query = this.input.value.trim().toLowerCase();
    const blocks = [];
    this.rows = [];
    for (const group of this.groups) {
      const found = group.items.filter((action) => this.matches(action, query));
      if (!found.length) continue;
      blocks.push(h("p.pal__label", { text: group.label }));
      for (const action of found) blocks.push(this.row(action));
    }
    if (conversations.length) {
      blocks.push(h("p.pal__label", { text: "Conversas" }));
      for (const item of conversations) {
        blocks.push(
          this.row({
            label: item.title || "Conversa sem título",
            glyph: "chat",
            run: () => this.onOpenConversation?.(item.id),
          }),
        );
      }
    }
    if (!blocks.length) {
      blocks.push(h("p.pal__none", { text: "Nada encontrado." }));
    }
    this.list.replaceChildren(...blocks);
    this.index = 0;
    this.mark();
  }

  row(action) {
    const node = h(
      "button.pal__row",
      {
        type: "button",
        role: "option",
        onclick: () => this.run(action),
        onmousemove: () => {
          const at = this.rows.indexOf(node);
          if (at >= 0 && at !== this.index) {
            this.index = at;
            this.mark();
          }
        },
      },
      h("span.pal__row-glyph", {}, icon(action.glyph || "chevron-right")),
      h("span.pal__row-label", { text: action.label }),
      action.hint ? h("kbd.pal__row-hint", { text: action.hint }) : null,
    );
    this.rows.push(node);
    return node;
  }

  mark() {
    this.rows.forEach((node, at) => {
      const on = at === this.index;
      node.classList.toggle("is-on", on);
      node.setAttribute("aria-selected", String(on));
      if (on) node.scrollIntoView({ block: "nearest" });
    });
  }

  move(step) {
    if (!this.rows.length) return;
    this.index = (this.index + step + this.rows.length) % this.rows.length;
    this.mark();
  }

  run(action) {
    this.close({ restore: false });
    action.run?.();
  }

  // ---------- Teclado e saída ----------

  key(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      const node = this.rows[this.index];
      if (node) {
        event.preventDefault();
        node.click();
      }
      return;
    }
    trapFocus(this.panel, event);
  }

  close({ restore = true } = {}) {
    if (current !== this) return;
    current = null;
    window.clearTimeout(this.timer);
    document.removeEventListener("keydown", this.onKey, true);
    this.root.classList.remove("is-open");
    const chat = document.getElementById("chat");
    if (chat) chat.inert = false;
    if (restore && this.opener instanceof HTMLElement && this.opener.isConnected) {
      this.opener.focus({ preventScroll: true });
    }
    window.setTimeout(() => this.root.remove(), reducedMotion() ? 0 : 180);
    announce("Paleta fechada.");
  }
}

function hint(keys, what) {
  return h("span.pal__hint", {}, h("kbd", { text: keys }), h("span", { text: what }));
}
