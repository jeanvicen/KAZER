// Configurações do KAZER: tudo aqui muda algo de verdade no servidor (ou na
// interface) e salva sozinho. No celular é uma pilha de telas; no computador,
// navegação à esquerda e conteúdo à direita.

import { announce, finePointer, formatDate, formatReset, h, icon, loadStyle, mark, reducedMotion, trapFocus } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";

const SECTIONS = [
  ["conta", "Conta", "user"],
  ["planos", "Uso e plano", "bolt"],
  ["personalizacao", "Personalização", "sparkle"],
  ["memoria", "Memória", "memory"],
  ["interface", "Aparência", "sliders"],
  ["dados", "Dados e privacidade", "shield"],
  ["terminal", "Terminal", "terminal"],
  ["sobre", "Sobre", "info"],
];

// Tela inicial: grupos como nos apps grandes. Cada linha abre uma seção real;
// "upgrade" abre direto a vitrine de planos. Palavras extras alimentam a busca.
const GROUPS = [
  ["Meu KAZER", [
    ["personalizacao", "Personalização", "sparkle", "apelido estilo instruções resposta"],
    ["memoria", "Memória", "memory", "lembrar salvar esquecer"],
  ]],
  ["Conta", [
    ["upgrade", "Fazer upgrade do plano", "bolt", "pro ultra assinar comprar"],
    ["planos", "Uso e plano", "research", "limite janela renova"],
    ["conta", "Conta", "user", "e-mail email senha sessões excluir"],
  ]],
  ["", [
    ["interface", "Aparência", "sliders", "tema escuro claro idioma texto tamanho animação enviar enter"],
  ]],
  ["", [
    ["dados", "Dados e privacidade", "shield", "exportar apagar histórico conversas"],
    ["terminal", "Terminal", "terminal", "cli linha de comando"],
    ["sobre", "Sobre", "info", "versão termos privacidade"],
  ]],
];

const THEME_LABELS = { escuro: "Escuro", claro: "Claro", sistema: "Sistema" };

// Iniciais do nome (ou do e-mail): "jean.vicen@..." vira "JV".
function initials(name) {
  const parts = String(name || "").split(/[\s._-]+/).filter(Boolean);
  const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
  return letters.replace(/[^\p{L}\p{N}]/gu, "") || "?";
}

const STYLE_SAMPLES = {
  direto: "Moa o café na hora, 1 colher para 100 ml de água a 92 °C. Molhe o filtro, despeje em círculos e pronto.",
  equilibrado:
    "Use 10 g de café moído médio para cada 150 ml de água quase fervendo (90–95 °C). Escalde o filtro, molhe o pó para ele “florescer” por 30 s e despeje o resto devagar, em círculos.",
  detalhado:
    "1. Escalde o filtro de papel (tira o gosto de papel e aquece o bule).\n2. Moa 20 g de café em granulação média.\n3. Aqueça 300 ml de água a 90–95 °C.\n4. Faça a pré-infusão: molhe o pó com um pouco de água e espere 30 s.\n5. Despeje o restante em círculos lentos, sem encharcar as bordas.\n\nO tempo total deve ficar perto de 3 minutos.",
};

const PASSWORD_ERRORS = {
  invalid_password: "A senha atual não confere.",
  password_too_short: "A nova senha precisa de pelo menos 10 caracteres.",
  password_too_long: "Use no máximo 128 caracteres.",
  password_too_common: "Essa senha é fácil demais de adivinhar. Tente uma frase mais longa.",
  rate_limited: "Muitas tentativas. Espere alguns minutos.",
  password_change_failed: "O servidor de contas não aceitou a troca agora. Tente de novo em instantes.",
};


let open = null;

export function openSettingsPanel(options) {
  if (open) return;
  open = new SettingsPanel(options);
}

class SettingsPanel {
  constructor({ opener, account, prefs, model, memories, section, onPreferences, onMemories, onHistoryCleared, onSignOut, onAccountDeleted }) {
    this.opener = opener;
    this.account = account || {};
    this.prefs = { ...prefs };
    this.model = model || { available: false, features: {} };
    this.usage = {};
    this.memories = [...memories];
    this.cb = { onPreferences, onMemories, onHistoryCleared, onSignOut, onAccountDeleted };
    // Seção pedida por quem abriu (a tela Terminal manda para Conta);
    // no celular ela entra de verdade, no computador só fica marcada.
    this.start = SECTIONS.some(([key]) => key === section) ? section : "";
    this.saveTimer = 0;
    this.pending = {};
    this.wide = window.matchMedia("(min-width: 60rem)").matches;
    this.build();
    this.load();
  }

  // ---------- Estrutura ----------

  build() {
    this.title = h("h2.settings__title.sr-only", { id: "settings-title", tabindex: "-1", text: "Configurações" });
    this.values = {};
    this.rows = [];
    this.groups = GROUPS.map(([label, items]) => {
      const rows = items.map(([key, text, iconName, words]) => {
        const value = h("span.nav-row__value");
        this.values[key] = value;
        const row = h(
          `button.settings__nav-item.nav-row${key === "upgrade" ? ".nav-row--accent" : ""}`,
          {
            type: "button",
            dataset: { section: key },
            onclick: (event) => (key === "upgrade" ? this.openUpgrade(event.currentTarget) : this.show(key, { focus: true })),
          },
          h("span.nav-row__icon", {}, icon(iconName)),
          h("span.nav-row__label", { text }),
          value,
          key === "upgrade" ? null : icon("chevron-right", "nav-row__go"),
        );
        row.searchText = `${text} ${words}`.toLowerCase();
        this.rows.push(row);
        return row;
      });
      const list = h("div.nav-list", {}, rows);
      const group = h("section.nav-group", {}, label ? h("h3.nav-group__title", { text: label }) : null, list);
      group.rowsIn = rows;
      return group;
    });
    this.navList = h("nav.settings__nav-list", { "aria-label": "Seções" }, this.groups);
    this.groups.forEach((group, index) => group.style.setProperty("--i", String(index)));

    const name = this.prefs?.nickname || (this.account.email || "").split("@")[0];
    this.avatar = h("span.settings__avatar", { "aria-hidden": "true", text: initials(name) });
    this.profileName = h("span.settings__name", { text: name || "Sua conta" });
    this.profile = h(
      "div.settings__profile",
      {},
      this.avatar,
      this.profileName,
      h("span.settings__email", { text: this.account.email || "" }),
      h("span.settings__since", { text: this.account.created_at ? `Desde ${formatDate(this.account.created_at)}` : "" }),
    );

    this.signOut = h(
      "button.set-signout",
      { type: "button", onclick: () => this.cb.onSignOut?.() },
      icon("sign-out"),
      h("span", { text: "Sair" }),
    );
    this.empty = h("p.set-empty", { hidden: true, text: "Nenhuma configuração encontrada." });
    this.search = h("input.set-search__input", {
      type: "search",
      placeholder: "Pesquisar configurações",
      "aria-label": "Pesquisar configurações",
      autocomplete: "off",
      enterkeyhint: "search",
    });
    this.search.addEventListener("input", () => this.filter(this.search.value));
    this.searchBar = h("label.set-search", {}, icon("search"), this.search);

    this.closeButton = h("button.icon-button.settings__close", { type: "button", "aria-label": "Fechar configurações", onclick: () => this.close() }, icon("back"));
    this.nav = h(
      "aside.settings__nav",
      {},
      h("header.settings__head", {}, this.closeButton, this.title),
      this.profile,
      this.navList,
      this.empty,
      this.signOut,
      this.searchBar,
    );
    this.paintNav();

    this.backButton = h("button.icon-button.settings__back", { type: "button", "aria-label": "Voltar", onclick: () => this.back() }, icon("back"));
    this.viewTitle = h("h3.settings__view-title", { tabindex: "-1" });
    this.saved = h("span.settings__saved", { "aria-hidden": "true" }, icon("check"), h("span", { text: "Salvo" }));
    this.viewBody = h("div.settings__view-body");
    this.view = h(
      "section.settings__view",
      { "aria-labelledby": "settings-view-title" },
      h("header.settings__view-head", {}, this.backButton, this.viewTitle, this.saved),
      this.viewBody,
    );
    this.viewTitle.id = "settings-view-title";
    this.panel = h("div.settings__panel", {}, this.nav, this.view);
    this.root = h(
      "div.settings",
      { role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title" },
      h("div.settings__scrim", { onclick: () => this.close() }),
      this.panel,
    );
    this.onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!this.wide && this.root.classList.contains("is-deep")) this.back();
        else this.close();
      } else trapFocus(this.panel, event);
    };
    document.addEventListener("keydown", this.onKey, true);
    document.body.append(this.root);
    const chat = document.getElementById("chat");
    if (chat) chat.inert = true;
    window.requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      if (this.start) this.show(this.start, { focus: !this.wide });
      else if (this.wide) this.show("conta", { focus: false });
      this.title.focus({ preventScroll: true });
    });
  }

  // Valores à direita das linhas (tema, plano, memória) e o nome no topo.
  paintNav() {
    const prefs = this.prefs || {};
    const usage = this.usage || {};
    const paid = usage.plan && usage.plan !== "free";
    this.values.interface.textContent = THEME_LABELS[prefs.theme] || "";
    this.values.memoria.textContent = prefs.memory_enabled === false ? "Desligada" : "Ligada";
    this.values.planos.textContent = usage.plan_name || "";
    this.values.conta.textContent = "";
    const upgrade = this.rows.find((row) => row.dataset.section === "upgrade");
    if (upgrade) upgrade.hidden = Boolean(paid);
    const name = prefs.nickname || (this.account.email || "").split("@")[0];
    this.avatar.textContent = initials(name);
    this.profileName.textContent = name || "Sua conta";
  }

  filter(query) {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    for (const group of this.groups) {
      let visible = 0;
      for (const row of group.rowsIn) {
        const match = !words.length || words.every((word) => row.searchText.includes(word));
        row.classList.toggle("is-filtered", !match);
        if (match && !row.hidden) visible += 1;
      }
      group.hidden = visible === 0;
      if (visible) any = true;
    }
    this.empty.hidden = any;
    this.signOut.hidden = words.length > 0;
  }

  async openUpgrade(opener) {
    const { openPlans } = await import("./plans.js");
    openPlans({ opener });
  }

  close() {
    document.removeEventListener("keydown", this.onKey, true);
    this.flush();
    this.root.classList.remove("is-open");
    const chat = document.getElementById("chat");
    if (chat) chat.inert = false;
    window.setTimeout(() => this.root.remove(), reducedMotion() ? 0 : 320);
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    open = null;
  }

  async load() {
    // Dados frescos (outra aba pode ter mudado algo).
    const result = await request("/api/settings");
    if (!result.ok) return;
    this.prefs = result.data.preferences;
    this.memories = result.data.memories;
    this.account = { ...this.account, ...result.data.account };
    this.model = result.data.model;
    this.usage = result.data.usage || this.usage;
    this.profile.querySelector(".settings__since").textContent = this.account.created_at ? `Desde ${formatDate(this.account.created_at)}` : "";
    this.paintNav();
    if (this.current) this.show(this.current, { focus: false, animate: false });
  }

  show(key, { focus = false, animate = true } = {}) {
    const [, label] = SECTIONS.find(([name]) => name === key);
    this.paintNav();
    const changed = this.current !== key;
    this.current = key;
    for (const item of this.navList.children) {
      const active = item.dataset.section === key;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
    this.viewTitle.textContent = label;
    const content = this[`section_${key}`]();
    this.viewBody.replaceChildren(content);
    // Entrada em cascata dos blocos da seção.
    [...content.children].forEach((child, index) => child.style.setProperty("--i", String(index)));
    if (animate && changed && !reducedMotion()) {
      this.viewBody.classList.remove("is-entering");
      void this.viewBody.offsetWidth;
      this.viewBody.classList.add("is-entering");
    }
    this.viewBody.scrollTop = 0;
    this.root.classList.add("is-deep");
    if (focus) window.setTimeout(() => this.viewTitle.focus({ preventScroll: true }), this.wide ? 0 : 280);
  }

  back() {
    this.root.classList.remove("is-deep");
    this.paintNav();
    const item = this.navList.querySelector(`[data-section="${this.current}"]`);
    window.setTimeout(() => item?.focus({ preventScroll: true }), 260);
  }

  // ---------- Salvamento automático ----------

  savePrefs(changes, { immediate = false } = {}) {
    Object.assign(this.prefs, changes);
    Object.assign(this.pending, changes);
    this.cb.onPreferences?.(changes);
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), immediate ? 0 : 650);
  }

  async flush() {
    window.clearTimeout(this.saveTimer);
    const changes = this.pending;
    if (!Object.keys(changes).length) return;
    this.pending = {};
    const result = await request("/api/settings", { body: { preferences: changes } });
    if (result.ok) {
      this.flashSaved();
      return;
    }
    toast(result.data.error === "network" ? "Sem conexão: a mudança não foi salva." : "Não deu para salvar essa mudança.");
  }

  flashSaved() {
    this.saved.classList.remove("is-shown");
    void this.saved.offsetWidth;
    this.saved.classList.add("is-shown");
    announce("Salvo.");
  }

  // ---------- Componentes ----------

  group(title, ...children) {
    const heading = title ? h("h4.set-group__title", {}, title) : null;
    return h("div.set-group", {}, heading, ...children);
  }

  row({ title, description, control, id }) {
    return h(
      "div.set-row",
      {},
      h("div.set-row__text", {}, h(id ? "label.set-row__title" : "span.set-row__title", { for: id, text: title }), description ? h("span.set-row__desc", { text: description }) : null),
      control,
    );
  }

  toggle({ id, checked, disabled = false, label, onChange }) {
    const input = h("input.switch__input", { type: "checkbox", role: "switch", id, checked, disabled, "aria-label": label });
    input.addEventListener("change", () => onChange(input.checked));
    return h("span.switch", {}, input, h("span.switch__track", { "aria-hidden": "true" }, h("span.switch__thumb")));
  }

  // Controle segmentado com indicador deslizante e setas do teclado.
  segmented({ label, options, value, onChange }) {
    const indicator = h("span.seg__glider", { "aria-hidden": "true" });
    const group = h("div.seg", { role: "radiogroup", "aria-label": label }, indicator);
    group.style.setProperty("--n", String(options.length));
    const buttons = options.map(([key, text], index) => {
      const button = h("button.seg__option", { type: "button", role: "radio", text, dataset: { value: key } });
      button.addEventListener("click", () => select(index, true));
      button.addEventListener("keydown", (event) => {
        const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!delta) return;
        event.preventDefault();
        const next = (index + delta + options.length) % options.length;
        select(next, true);
        buttons[next].focus();
      });
      group.append(button);
      return button;
    });
    const select = (index, fire) => {
      buttons.forEach((button, i) => {
        button.setAttribute("aria-checked", String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
      group.style.setProperty("--k", String(index));
      if (fire && options[index][0] !== value) {
        value = options[index][0];
        onChange(value);
      }
    };
    select(Math.max(0, options.findIndex(([key]) => key === value)), false);
    return group;
  }

  // Botão de segurar para confirmar ações irreversíveis (teclado: segurar Enter/Espaço).
  holdButton({ label, hint, run, disabled = () => false }) {
    const fill = h("span.hold__fill", { "aria-hidden": "true" });
    const text = h("span.hold__label", { text: label });
    const button = h("button.hold", { type: "button", "aria-label": `${label}. ${hint}` }, fill, icon("trash"), text);
    let start = 0;
    let frame = 0;
    let done = false;
    const duration = reducedMotion() ? 900 : 1400;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      button.style.setProperty("--hold", String(progress));
      if (progress >= 1) {
        done = true;
        button.classList.remove("is-holding");
        button.classList.add("is-armed");
        navigator.vibrate?.(30);
        run(button);
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    const begin = (event) => {
      if (button.disabled || done || disabled()) return;
      if (event.type === "keydown" && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
      event.preventDefault();
      start = performance.now();
      button.classList.add("is-holding");
      text.textContent = "Segure…";
      frame = window.requestAnimationFrame(step);
    };
    const cancel = () => {
      if (done) return;
      window.cancelAnimationFrame(frame);
      button.classList.remove("is-holding");
      button.style.setProperty("--hold", "0");
      text.textContent = label;
    };
    button.addEventListener("pointerdown", begin);
    button.addEventListener("keydown", begin);
    for (const name of ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"]) button.addEventListener(name, cancel);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.reset = () => {
      done = false;
      button.classList.remove("is-armed");
      cancel();
    };
    return h("div.hold-wrap", {}, button, h("p.hold__hint", { text: hint }));
  }

  // ---------- Seções ----------

  // Resumo do plano aqui dentro; a tela cheia, com os três planos e as
  // animações, abre sob demanda (plans.js e plans.css só baixam no clique).
  section_planos() {
    const usage = this.usage || {};
    const allowance = usage.allowance || 0;
    const used = Math.min(usage.consumed || 0, allowance);
    // Só a proporção: nenhum número de limite aparece para a pessoa. O mesmo
    // gasto enche mais rápido num plano menor e mais devagar num maior.
    const ratio = allowance ? used / allowance : 0;
    const known = Boolean(allowance);

    const level = h("span.orb__liquid", {}, h("span.orb__wave"), h("span.orb__wave.orb__wave--back"));
    const orb = h(
      `div.orb.orb--big${ratio >= 0.85 ? ".is-high" : ""}`,
      { role: "img", "aria-label": "Uso da janela atual" },
      h("span.orb__glow", { "aria-hidden": "true" }),
      h("span.orb__glass", { "aria-hidden": "true" }, level, h("span.orb__bubbles"), h("span.orb__shine")),
    );
    // Sobe devagar até o nível real (o líquido "enche" na frente da pessoa).
    window.requestAnimationFrame(() => {
      window.setTimeout(() => orb.style.setProperty("--fill", String(Math.max(known ? 0.06 : 0, Math.min(ratio, 1)))), 60);
    });

    const open = h(
      "button.plans-cta",
      {
        type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          button.classList.add("is-busy");
          try {
            const { openPlans } = await import("./plans.js");
            await openPlans({ opener: button });
          } finally {
            button.classList.remove("is-busy");
          }
        },
      },
      h("span.plans-cta__icon", {}, icon("bolt")),
      h(
        "span.plans-cta__text",
        {},
        h("strong", { text: "Ver planos" }),
        h("span", { text: "Pro e Ultra" }),
      ),
      icon("chevron-right"),
    );

    return h(
      "div.use-page",
      {},
      h(
        "div.use-hero",
        {},
        orb,
        h("span.use-hero__plan", { text: usage.plan_name || "KAZER" }),
        h("span.use-hero__label", { text: "Uso da janela atual" }),
        usage.reset_at ? h("span.use-hero__reset", { text: `Renova ${formatReset(usage.reset_at)}` }) : null,
      ),
      this.group("", open),
    );
  }

  section_conta() {
    const verified = this.account.verified_at;
    const card = h(
      "div.id-card",
      {},
      h("span.id-card__avatar", { "aria-hidden": "true" }, h("span", { text: (this.account.email || "?").charAt(0).toUpperCase() }), mark("id-card__mark")),
      h(
        "div.id-card__text",
        {},
        h("span.id-card__email", { text: this.account.email || "" }),
        h("span.id-card__meta", { text: this.account.created_at ? `Conta criada em ${formatDate(this.account.created_at)}` : "" }),
        verified ? h("span.badge", {}, icon("check"), h("span", { text: "E-mail confirmado" })) : null,
      ),
    );

    const form = this.passwordForm();
    const toggle = h("button.pill-button", { type: "button", "aria-expanded": "false", text: "Alterar senha" });
    toggle.addEventListener("click", () => {
      const opening = form.hidden;
      form.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.textContent = opening ? "Cancelar" : "Alterar senha";
      if (opening) form.querySelector("input").focus();
    });

    const sessionsStatus = h("span.set-row__desc", { text: "Encerra o acesso em outros navegadores e aparelhos." });
    const revoke = h("button.pill-button", { type: "button", text: "Sair dos outros" });
    revoke.addEventListener("click", async () => {
      const yes = await confirmDialog({ title: "Sair dos outros dispositivos?", body: "Este aparelho continua conectado. Os outros precisarão entrar de novo.", confirm: "Sair dos outros", opener: revoke });
      if (!yes) return;
      revoke.disabled = true;
      const result = await request("/api/account/sessions/revoke", { body: {} });
      revoke.disabled = false;
      if (!result.ok) {
        toast("Não deu para encerrar as outras sessões agora.");
        return;
      }
      const count = result.data.revoked;
      // -1: o provedor de contas encerra as outras sessões sem dizer quantas eram.
      sessionsStatus.textContent =
        count < 0
          ? "Os outros dispositivos foram desconectados."
          : count
            ? `${count} ${count === 1 ? "sessão encerrada" : "sessões encerradas"}.`
            : "Nenhum outro dispositivo estava conectado.";
      announce(sessionsStatus.textContent);
    });

    return h(
      "div.set-section",
      {},
      card,
      this.group(
        "Segurança",
        h("div.set-row", {}, h("div.set-row__text", {}, h("span.set-row__title", { text: "Senha" }), h("span.set-row__desc", { text: "Ao trocar, você sai dos outros dispositivos." })), toggle),
        form,
        h("div.set-row", {}, h("div.set-row__text", {}, h("span.set-row__title", { text: "Dispositivos" }), sessionsStatus), revoke),
      ),
      this.group(
        null,
        h("button.set-link", { type: "button", onclick: () => this.cb.onSignOut?.() }, icon("sign-out"), h("span", { text: "Sair desta conta" })),
      ),
    );
  }

  passwordForm() {
    const field = (id, label, autocomplete) =>
      h("div.set-field", {}, h("label.set-field__label", { for: id, text: label }), h("input.set-field__input", { id, type: "password", autocomplete, maxlength: "128", required: true }));
    const meter = h("div.meter", { "aria-hidden": "true" }, h("span"), h("span"), h("span"), h("span"));
    const meterText = h("span.meter__text");
    const status = h("p.set-form__status", { role: "status" });
    const submit = h("button.pill-button.pill-button--solid", { type: "submit", text: "Salvar nova senha" });
    const form = h(
      "form.set-form",
      { hidden: true, novalidate: true },
      field("pw-current", "Senha atual", "current-password"),
      field("pw-new", "Nova senha", "new-password"),
      h("div.meter-row", {}, meter, meterText),
      field("pw-confirm", "Repita a nova senha", "new-password"),
      status,
      h("div.set-form__actions", {}, submit),
    );
    const [current, next, confirm] = ["pw-current", "pw-new", "pw-confirm"].map((id) => form.querySelector(`#${id}`));
    next.addEventListener("input", () => {
      const value = next.value;
      let score = 0;
      if (value.length >= 10) score += 1;
      if (value.length >= 16) score += 1;
      if (/\s/.test(value) || (/[a-z]/i.test(value) && /\d/.test(value))) score += 1;
      if (value.length >= 22 || /[^\w\s]/.test(value)) score += 1;
      if (value.length < 10) score = Math.min(score, 1);
      meter.dataset.score = String(value ? Math.max(1, score) : 0);
      meterText.textContent = !value ? "" : ["", "Fraca", "Razoável", "Boa", "Forte"][Math.max(1, score)];
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "";
      if (next.value.length < 10) {
        status.textContent = "A nova senha precisa de pelo menos 10 caracteres.";
        next.focus();
        return;
      }
      if (next.value !== confirm.value) {
        status.textContent = "As senhas não coincidem.";
        confirm.focus();
        return;
      }
      submit.disabled = true;
      const result = await request("/api/account/password", { body: { current_password: current.value, password: next.value } });
      submit.disabled = false;
      if (result.ok) {
        form.reset();
        meter.dataset.score = "0";
        meterText.textContent = "";
        status.textContent = "Senha alterada. Os outros dispositivos foram desconectados.";
        return;
      }
      status.textContent = PASSWORD_ERRORS[result.data.error] || "Não deu para trocar a senha agora.";
      if (result.data.error === "invalid_password") current.focus();
    });
    return form;
  }

  section_personalizacao() {
    const name = h("input.set-field__input", { id: "pref-nickname", type: "text", maxlength: "40", autocomplete: "given-name", placeholder: "Seu nome ou apelido", value: this.prefs.nickname || "" });
    const preview = h("p.greet-preview", {});
    const paintPreview = () => {
      const hour = new Date().getHours();
      const base = hour < 5 ? "Ainda por aqui?" : hour < 12 ? "Bom dia." : hour < 18 ? "Boa tarde." : "Boa noite.";
      const nick = name.value.trim();
      preview.replaceChildren(h("span.greet-preview__mark", {}, mark()), h("span", { text: nick ? base.replace(/([.?!])$/, `, ${nick}$1`) : base }));
    };
    paintPreview();
    name.addEventListener("input", () => {
      paintPreview();
      this.savePrefs({ nickname: name.value.trim() });
    });

    const sample = h("div.style-sample__text");
    const bubble = h("div.style-sample", {}, h("span.style-sample__q", { text: "Como faço café coado?" }), h("div.style-sample__a", {}, mark("style-sample__mark"), sample));
    let typing = 0;
    const type = (style) => {
      window.clearInterval(typing);
      const text = STYLE_SAMPLES[style];
      if (reducedMotion()) {
        sample.textContent = text;
        return;
      }
      let index = 0;
      sample.textContent = "";
      typing = window.setInterval(() => {
        index = Math.min(text.length, index + 3);
        sample.textContent = text.slice(0, index);
        if (index >= text.length) window.clearInterval(typing);
      }, 16);
    };
    type(this.prefs.style || "equilibrado");

    const instructions = h("textarea.set-field__input.set-field__area", {
      id: "pref-instructions",
      maxlength: "1500",
      rows: "5",
      placeholder: "Ex.: Trabalho com design. Prefiro exemplos práticos e respostas sem rodeios.",
    });
    instructions.value = this.prefs.instructions || "";
    const counter = h("span.set-field__count", { text: `${instructions.value.length}/1500` });
    instructions.addEventListener("input", () => {
      counter.textContent = `${instructions.value.length}/1500`;
      this.savePrefs({ instructions: instructions.value });
    });

    return h(
      "div.set-section",
      {},
      this.group(
        "Como o KAZER deve te chamar?",
        h("div.set-field", {}, h("label.sr-only", { for: "pref-nickname", text: "Nome ou apelido" }), name),
        preview,
      ),
      this.group(
        "Estilo das respostas",
        this.segmented({
          label: "Estilo das respostas",
          options: [["direto", "Direto"], ["equilibrado", "Equilibrado"], ["detalhado", "Detalhado"]],
          value: this.prefs.style || "equilibrado",
          onChange: (value) => {
            type(value);
            this.savePrefs({ style: value }, { immediate: true });
          },
        }),
        bubble,
      ),
      this.group(
        "Instruções pessoais",
        h("p.set-group__desc", { text: "Contexto que o KAZER leva em conta em todas as conversas. Não muda as regras de segurança dele." }),
        h("div.set-field", {}, h("label.sr-only", { for: "pref-instructions", text: "Instruções pessoais" }), instructions, counter),
      ),
    );
  }

  section_memoria() {
    const list = h("ul.memories", { "aria-label": "Memórias salvas" });
    const count = h("span.memories__count");
    const empty = h(
      "div.memories__empty",
      {},
      mark("memories__mark"),
      h("p", { text: "Nada guardado ainda." }),
      h("span", { text: "O KAZER só lembra o que você salvar aqui. Nada é salvo automaticamente." }),
    );
    const input = h("input.set-field__input", { id: "memory-new", type: "text", maxlength: "500", placeholder: "Ex.: Uso Python e trabalho remoto", autocomplete: "off" });
    const add = h("button.pill-button.pill-button--solid", { type: "submit", text: "Salvar" });
    const status = h("p.set-form__status", { role: "status" });

    const paint = () => {
      list.replaceChildren(...this.memories.map((memory) => item(memory)));
      empty.hidden = this.memories.length > 0;
      count.textContent = `${this.memories.length} de 100`;
      this.cb.onMemories?.(this.memories);
    };
    const item = (memory) => {
      const remove = h("button.icon-button.memory__remove", { type: "button", "aria-label": `Esquecer: ${memory.content}` }, icon("close"));
      const li = h("li.memory", {}, h("span.memory__dot", { "aria-hidden": "true" }), h("span.memory__text", { text: memory.content }), remove);
      remove.addEventListener("click", async () => {
        li.classList.add("is-leaving");
        const result = await request(`/api/memories/${memory.id}`, { method: "DELETE" });
        if (!result.ok && result.data.error !== "not_found") {
          li.classList.remove("is-leaving");
          toast("Não deu para esquecer agora.");
          return;
        }
        window.setTimeout(() => {
          this.memories = this.memories.filter((other) => other.id !== memory.id);
          paint();
          input.focus();
        }, reducedMotion() ? 0 : 220);
      });
      return li;
    };

    const form = h("form.memory-add", { novalidate: true }, h("label.sr-only", { for: "memory-new", text: "Nova memória" }), input, add);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = input.value.trim();
      if (!content) {
        input.focus();
        return;
      }
      add.disabled = true;
      status.textContent = "";
      const result = await request("/api/memories", { body: { content } });
      add.disabled = false;
      if (!result.ok) {
        status.textContent = result.data.error === "memory_full" ? "Limite de 100 memórias atingido." : "Não deu para salvar agora.";
        return;
      }
      this.memories.push(result.data.memory);
      input.value = "";
      paint();
      list.lastElementChild?.classList.add("is-new");
      this.flashSaved();
    });

    const enabled = this.prefs.memory_enabled !== false;
    const clearAll = h("button.set-link.set-link--quiet", { type: "button" }, icon("trash"), h("span", { text: "Esquecer tudo" }));
    clearAll.addEventListener("click", async () => {
      if (!this.memories.length) return;
      const yes = await confirmDialog({ title: "Esquecer todas as memórias?", body: "O KAZER deixa de usar tudo o que você salvou aqui.", confirm: "Esquecer tudo", danger: true, opener: clearAll });
      if (!yes) return;
      const result = await request("/api/memories/clear", { body: { confirm: true } });
      if (!result.ok) {
        toast("Não deu para apagar agora.");
        return;
      }
      this.memories = [];
      paint();
    });

    paint();
    const section = h(
      "div.set-section",
      {},
      this.group(
        null,
        this.row({
          title: "Usar memória nas conversas",
          description: "Quando ligada, o KAZER considera as memórias abaixo. Dá para desligar por conversa no botão +.",
          id: "pref-memory",
          control: this.toggle({
            id: "pref-memory",
            checked: enabled,
            label: "Usar memória nas conversas",
            onChange: (on) => {
              this.savePrefs({ memory_enabled: on }, { immediate: true });
              section.classList.toggle("is-muted", !on);
            },
          }),
        }),
      ),
      this.group("Adicionar", form, status),
      this.group(h("span.memories__head", {}, h("span", { text: "Guardadas" }), count), list, empty, clearAll),
    );
    section.classList.toggle("is-muted", !enabled);
    return section;
  }

  // Idioma: grava no servidor, guarda uma cópia no aparelho e recarrega, para tudo
  // mudar junto (o dicionário só é baixado em inglês).
  async changeLanguage(value) {
    if (value === (this.prefs.language || "pt")) return;
    const result = await request("/api/settings", { method: "POST", body: { preferences: { language: value } } });
    if (!result.ok) {
      toast("Não deu para mudar o idioma agora.");
      return;
    }
    const ui = JSON.parse(window.localStorage.getItem("kazer:ui") || "{}");
    window.localStorage.setItem("kazer:ui", JSON.stringify({ ...ui, language: value }));
    window.location.reload();
  }

  section_interface() {
    const sizePreview = h("p.size-preview", { text: "Exemplo de resposta neste tamanho." });
    return h(
      "div.set-section",
      {},
      this.group(
        "Tema",
        this.segmented({
          label: "Tema",
          options: [["escuro", "Escuro"], ["claro", "Claro"], ["sistema", "Sistema"]],
          value: this.prefs.theme || "escuro",
          onChange: (value) => this.savePrefs({ theme: value }, { immediate: true }),
        }),
        h("p.set-group__desc", { text: "Sistema acompanha o tema do aparelho." }),
      ),
      this.group(
        "Idioma",
        this.segmented({
          label: "Idioma",
          options: [["pt", "Português"], ["en", "English"]],
          value: this.prefs.language || "pt",
          onChange: (value) => this.changeLanguage(value),
        }),
        h("p.set-group__desc", { text: "O KAZER responde no idioma escolhido. A página recarrega ao trocar." }),
      ),
      this.group(
        "Animações",
        this.segmented({
          label: "Animações",
          options: [["sistema", "Sistema"], ["reduzido", "Reduzidas"], ["completo", "Completas"]],
          value: this.prefs.motion || "sistema",
          onChange: (value) => this.savePrefs({ motion: value }, { immediate: true }),
        }),
        h("p.set-group__desc", { text: "Sistema acompanha a preferência de movimento do aparelho." }),
      ),
      this.group(
        "Tamanho do texto",
        this.segmented({
          label: "Tamanho do texto",
          options: [["p", "Pequeno"], ["m", "Médio"], ["g", "Grande"]],
          value: this.prefs.text_size || "m",
          onChange: (value) => this.savePrefs({ text_size: value }, { immediate: true }),
        }),
        sizePreview,
      ),
      this.group(
        null,
        this.row({
          title: "Fundo animado",
          description: "Animação de fundo na tela de nova conversa.",
          id: "pref-ambient",
          control: this.toggle({ id: "pref-ambient", checked: this.prefs.ambient !== false, label: "Fundo animado", onChange: (on) => this.savePrefs({ ambient: on }, { immediate: true }) }),
        }),
        this.row({
          title: "Enviar com Enter",
          description: finePointer() ? "Shift + Enter pula linha." : "No celular, Enter sempre pula linha; envie pelo botão.",
          id: "pref-enter",
          control: this.toggle({ id: "pref-enter", checked: this.prefs.send_on_enter !== false, label: "Enviar com Enter", onChange: (on) => this.savePrefs({ send_on_enter: on }, { immediate: true }) }),
        }),
      ),
    );
  }

  section_dados() {
    const exportButton = h("button.pill-button", { type: "button" }, icon("download"), h("span", { text: "Baixar meus dados" }));
    exportButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      try {
        const response = await fetch("/api/account/export", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("export");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = h("a", { href: url, download: "kazer-dados.json" });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast("Download iniciado.");
      } catch {
        toast("Não deu para gerar o arquivo agora.");
      } finally {
        exportButton.disabled = false;
      }
    });

    const clearHistory = this.holdButton({
      label: "Apagar todas as conversas",
      hint: "Segure para confirmar. Esta ação não pode ser desfeita.",
      run: async (button) => {
        const result = await request("/api/conversations/clear", { body: { confirm: true } });
        button.reset();
        if (!result.ok) {
          toast("Não deu para apagar agora.");
          return;
        }
        toast("Todas as conversas foram apagadas.");
        this.cb.onHistoryCleared?.();
      },
    });

    const password = h("input.set-field__input", { id: "delete-password", type: "password", autocomplete: "current-password", maxlength: "128", placeholder: "Sua senha" });
    const deleteStatus = h("p.set-form__status", { role: "status" });
    const deleteAccount = this.holdButton({
      label: "Excluir minha conta",
      hint: "Digite a senha e segure o botão. Conta, conversas, anexos e memórias somem para sempre.",
      disabled: () => {
        if (password.value) return false;
        deleteStatus.textContent = "Digite sua senha antes.";
        password.focus();
        return true;
      },
      run: async (button) => {
        deleteStatus.textContent = "";
        const result = await request("/api/account/delete", { body: { password: password.value } });
        if (result.ok) {
          this.cb.onAccountDeleted?.();
          return;
        }
        button.reset();
        deleteStatus.textContent =
          {
            invalid_password: "Senha incorreta.",
            rate_limited: "Muitas tentativas. Espere alguns minutos.",
            account_delete_unavailable:
              "A exclusão automática ainda não está configurada neste servidor. Apague as conversas acima e peça a exclusão pelo canal da Política de Privacidade.",
          }[result.data.error] || "Não deu para excluir agora.";
      },
    });

    const fact = (iconName, title, text) => h("li.fact", {}, h("span.fact__icon", {}, icon(iconName)), h("span.fact__text", {}, h("strong", { text: title }), h("span", { text })));
    return h(
      "div.set-section",
      {},
      this.group(
        "O que fica guardado",
        h(
          "ul.facts",
          {},
          fact("user", "Conta", "E-mail e um hash da senha. Nunca a senha em si."),
          fact("compose", "Conversas e anexos", "Ficam até você apagar. Anexos são privados da sua conta."),
          fact("memory", "Memórias", "Só as que você salvar, e só são usadas se a memória estiver ligada."),
          fact("globe", "Processamento", "Para gerar respostas, suas mensagens vão ao provedor de modelo configurado neste servidor."),
        ),
        h("p.set-group__desc", {}, "Detalhes na ", h("a", { href: "/privacidade", target: "_blank", rel: "noopener", text: "Política de Privacidade" }), "."),
      ),
      this.group("Portabilidade", h("div.set-row", {}, h("div.set-row__text", {}, h("span.set-row__title", { text: "Exportar dados" }), h("span.set-row__desc", { text: "Um arquivo JSON com conta, conversas, memórias e preferências." })), exportButton)),
      this.group("Histórico", clearHistory),
      this.group("Excluir conta", h("div.set-field", {}, h("label.set-field__label", { for: "delete-password", text: "Confirme com sua senha" }), password), deleteStatus, deleteAccount),
    );
  }

  section_skills() {
    const holder = h("div.settings__embed");
    (async () => {
      await loadStyle("/assets/screens.css");
      const { createSkills } = await import("./skills.js");
      const view = await createSkills();
      if (!holder.isConnected && this.current !== "skills") return;
      holder.replaceChildren(
        h("div.sc.sc--embedded", {}, view.search, h("div.sc__body", {}, view.body), view.fab),
      );
    })().catch(() => holder.replaceChildren(h("p.set-note", { text: "Não deu para abrir as Skills agora." })));
    return holder;
  }

  section_terminal() {
    const holder = h("div.settings__embed");
    (async () => {
      await loadStyle("/assets/screens.css");
      const { createTerminal } = await import("./terminal-screen.js");
      const view = await createTerminal({ onOpenSettings: (key) => this.show(key, { focus: true }) });
      if (!holder.isConnected && this.current !== "terminal") return;
      holder.replaceChildren(h("div.sc.sc--embedded", {}, h("div.sc__body", {}, view.body)));
    })().catch(() => holder.replaceChildren(h("p.set-note", { text: "Não deu para abrir o Terminal agora." })));
    return holder;
  }

  section_sobre() {
    const features = this.model.features || {};
    const status = (on, yes, no) => h(`span.status${on ? ".is-on" : ""}`, {}, h("span.status__dot", { "aria-hidden": "true" }), h("span", { text: on ? yes : no }));
    const brand = h("div.about__brand", {}, mark("about__mark"), h("span.about__word", { text: "KAZER" }));
    brand.addEventListener("pointerenter", () => brand.querySelector(".about__mark").classList.add("is-generating"));
    brand.addEventListener("pointerleave", () => brand.querySelector(".about__mark").classList.remove("is-generating"));
    const line = (label, value) => h("div.about__row", {}, h("dt", { text: label }), h("dd", {}, value));
    return h(
      "div.set-section",
      {},
      brand,
      h(
        "dl.about",
        {},
        line("Modelo", h("span", {}, h("strong", { text: "KAZ 1.1 " }), status(this.model.available, "Conectado", "Não configurado"))),
        line("Esforço", h("span", { text: "Baixo" })),
        line("Pensamento profundo", status(features.deep, "Disponível", "Indisponível")),
        line("Imagens", status(features.images, "Disponível", "Indisponível")),
        line("Busca na web", status(features.web_search, "Disponível", "Indisponível")),
        line("Pesquisa", status(false, "", "Indisponível")),
        line("Voz", status(false, "", "Indisponível")),
      ),
      h(
        "p.about__legal",
        {},
        h("a", { href: "/termos", target: "_blank", rel: "noopener", text: "Termos de Uso" }),
        h("span", { "aria-hidden": "true", text: " · " }),
        h("a", { href: "/privacidade", target: "_blank", rel: "noopener", text: "Política de Privacidade" }),
      ),
    );
  }
}
