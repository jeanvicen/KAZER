// Configurações do KAZER: tudo aqui muda algo de verdade no servidor (ou na
// interface) e salva sozinho. No celular é uma pilha de telas; no computador,
// navegação à esquerda e conteúdo à direita.

import { announce, finePointer, formatDate, formatReset, h, icon, mark, reducedMotion, trapFocus } from "./dom.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, toast } from "./sheets.js";

const SECTIONS = [
  ["conta", "Conta", "user"],
  ["planos", "Planos", "bolt"],
  ["personalizacao", "Personalização", "sparkle"],
  ["memoria", "Memória", "memory"],
  ["interface", "Interface", "sliders"],
  ["dados", "Dados e privacidade", "shield"],
  ["conectores", "Conectores", "plug"],
  ["sobre", "Sobre", "info"],
];

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

// Milhar com ponto, como se escreve em português.
const num = (value) => Number(value || 0).toLocaleString("pt-BR");

const CONNECT_ERRORS = {
  connector_invalid: "Endereço inválido: precisa ser https e falar MCP.",
  connector_unreachable: "O serviço não respondeu.",
  connector_rejected: "O serviço recusou: confira a credencial.",
  connector_limit: "Você chegou ao limite de conectores do seu plano.",
  plan_required: "Conectores entram com os planos pagos.",
};

let open = null;

export function openSettingsPanel(options) {
  if (open) return;
  open = new SettingsPanel(options);
}

class SettingsPanel {
  constructor({ opener, account, prefs, model, memories, onPreferences, onMemories, onHistoryCleared, onSignOut, onAccountDeleted }) {
    this.opener = opener;
    this.account = account || {};
    this.prefs = { ...prefs };
    this.model = model || { available: false, features: {} };
    this.usage = {};
    this.memories = [...memories];
    this.cb = { onPreferences, onMemories, onHistoryCleared, onSignOut, onAccountDeleted };
    this.saveTimer = 0;
    this.pending = {};
    this.wide = window.matchMedia("(min-width: 60rem)").matches;
    this.build();
    this.load();
  }

  // ---------- Estrutura ----------

  build() {
    this.title = h("h2.settings__title", { id: "settings-title", tabindex: "-1", text: "Configurações" });
    this.navList = h(
      "nav.settings__nav-list",
      { "aria-label": "Seções" },
      SECTIONS.map(([key, label, iconName]) =>
        h(
          "button.settings__nav-item",
          { type: "button", dataset: { section: key }, onclick: () => this.show(key, { focus: true }) },
          h("span.settings__nav-icon", {}, icon(iconName)),
          h("span", { text: label }),
          icon("chevron-right", "settings__nav-go"),
        ),
      ),
    );
    // `style` em atributo é bloqueado pela CSP: as variáveis vão por CSSOM.
    this.navList.querySelectorAll(".settings__nav-item").forEach((item, index) => item.style.setProperty("--i", String(index)));
    this.profile = h(
      "div.settings__profile",
      {},
      h("span.settings__avatar", { "aria-hidden": "true" }, (this.account.email || "?").charAt(0).toUpperCase()),
      h(
        "span.settings__who",
        {},
        h("span.settings__email", { text: this.account.email || "" }),
        h("span.settings__since", { text: this.account.created_at ? `Desde ${formatDate(this.account.created_at)}` : "" }),
      ),
    );
    this.closeButton = h("button.icon-button.settings__close", { type: "button", "aria-label": "Fechar configurações", onclick: () => this.close() }, icon("close"));
    this.nav = h("aside.settings__nav", {}, h("header.settings__head", {}, this.title, this.closeButton), this.profile, this.navList);

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
      if (this.wide) this.show("conta", { focus: false });
      this.title.focus({ preventScroll: true });
    });
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
    if (this.current) this.show(this.current, { focus: false, animate: false });
  }

  show(key, { focus = false, animate = true } = {}) {
    const [, label] = SECTIONS.find(([name]) => name === key);
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
    const left = Math.max(allowance - used, 0);
    const pct = allowance ? Math.round((used / allowance) * 100) : 0;

    const fill = h("span.use-bar__fill");
    window.requestAnimationFrame(() => fill.style.setProperty("--pct", `${pct}%`));

    const open = h(
      "button.set-action.set-action--accent",
      {
        type: "button",
        onclick: async (event) => {
          const { openPlans } = await import("./plans.js");
          openPlans({ opener: event.currentTarget });
        },
      },
      icon("bolt"),
      h("span", { text: usage.plan === "free" ? "Ver os planos do KAZER" : "Ver todos os planos" }),
      icon("chevron-right"),
    );

    return h(
      "div",
      {},
      this.group(
        "Seu plano",
        h(
          "div.use-card",
          {},
          h(
            "div.use-card__head",
            {},
            h("span.use-card__name", { text: usage.plan_name || "KAZER" }),
            usage.plan && usage.plan !== "free" ? h("span.use-card__tag", { text: "Ativo" }) : null,
          ),
          allowance
            ? h(
                "div.use-card__meter",
                {},
                h(
                  "div.use-bar",
                  {
                    role: "progressbar",
                    "aria-valuemin": "0",
                    "aria-valuemax": String(allowance),
                    "aria-valuenow": String(used),
                    "aria-label": "Uso da janela atual",
                  },
                  fill,
                ),
                h("span.use-card__text", {
                  text: `${num(left)} de ${num(allowance)} unidades restantes${
                    usage.window_hours ? ` nesta janela de ${usage.window_hours} h` : ""
                  }.`,
                }),
                usage.reset_at
                  ? h("span.use-card__reset", { text: `Renova ${formatReset(usage.reset_at)}.` })
                  : null,
              )
            : h("p.set-note", { text: "O uso desta conta aparece aqui assim que o servidor informar." }),
        ),
      ),
      this.group("Mais uso", open, h("p.set-note", { text: "A assinatura ainda não abriu: dá para ver os planos e deixar seu interesse, sem cobrança." })),
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
        h("div.set-row", {}, h("div.set-row__text", {}, h("span.set-row__title", { text: "Senha" }), h("span.set-row__desc", { text: "Guardada só como hash Argon2id. Ao trocar, os outros dispositivos saem." })), toggle),
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

  section_interface() {
    const sizePreview = h("p.size-preview", { text: "O KAZER responde aqui, neste tamanho." });
    return h(
      "div.set-section",
      {},
      this.group(
        "Animações",
        this.segmented({
          label: "Animações",
          options: [["sistema", "Sistema"], ["reduzido", "Reduzidas"], ["completo", "Completas"]],
          value: this.prefs.motion || "sistema",
          onChange: (value) => this.savePrefs({ motion: value }, { immediate: true }),
        }),
        h("p.set-group__desc", { text: "“Sistema” segue a preferência de movimento do seu aparelho." }),
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
          description: "Os quadradinhos da conversa vazia. Somem sozinhos depois da primeira mensagem.",
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
      hint: "Segure o botão para confirmar. Não dá para desfazer.",
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
      this.group("Zona de exclusão", h("div.set-field", {}, h("label.set-field__label", { for: "delete-password", text: "Confirme com sua senha" }), password), deleteStatus, deleteAccount),
    );
  }

  // Catálogo de conectores: busca, categorias e o que o plano desta conta
  // libera em cada um. A lista vem do servidor, uma página por vez.
  section_conectores() {
    const state = { q: "", category: "", page: 0, loading: false, done: false };
    const list = h("div.conns__list");
    const count = h("p.conns__count", { text: "Carregando o catálogo…" });
    const more = h("button.conns__more", { type: "button", hidden: true, text: "Ver mais" });
    const search = h("input.set-field__input", {
      type: "search",
      placeholder: "Buscar conector",
      "aria-label": "Buscar conector",
      autocomplete: "off",
      spellcheck: "false",
      maxlength: "80",
    });
    const chips = h("div.conns__cats", { role: "tablist", "aria-label": "Categorias" });

    let heavy = null;
    const root = this.viewBody;
    const load = async ({ reset = false } = {}) => {
      if (state.loading) return;
      state.loading = true;
      more.disabled = true;
      if (!list.children.length) {
        const { createLoader } = await import("./loader.js");
        heavy = heavy || createLoader(count, { label: "Abrindo o catálogo…" });
        heavy.start();
      }
      if (reset) {
        state.page = 0;
        state.done = false;
        list.replaceChildren();
      }
      const query = new URLSearchParams({ page: String(state.page) });
      if (state.q) query.set("q", state.q);
      if (state.category) query.set("category", state.category);
      const result = await request(`/api/connectors?${query}`);
      state.loading = false;
      heavy?.stop();
      if (!result.ok) {
        count.textContent = "Não deu para carregar o catálogo agora.";
        return;
      }
      const data = result.data;
      const head = root.querySelector("#conn-count");
      if (head) {
        const on = data.items.filter((item) => item.connected).length;
        head.textContent = on
          ? `${on} conector${on === 1 ? "" : "es"} conectado${on === 1 ? "" : "s"} nesta página.`
          : "Nenhum conector conectado.";
      }
      if (!chips.children.length) buildChips(data.categories);
      for (const item of data.items) list.append(card(item));
      count.textContent = describe(data);
      state.done = !data.has_more;
      more.hidden = state.done;
      more.disabled = false;
      state.page += 1;
    };

    const describe = (data) => {
      const n = data.total;
      const base = `${num(n)} conector${n === 1 ? "" : "es"} no catálogo`;
      return state.q || state.category ? `${base} nesta busca.` : `${base}.`;
    };

    const buildChips = (categories) => {
      const make = (value, label) =>
        h(
          "button.conns__cat",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(state.category === value),
            onclick: () => {
              state.category = value;
              for (const chip of chips.children) chip.setAttribute("aria-selected", String(chip.dataset.value === value));
              load({ reset: true });
            },
            dataset: { value },
          },
          h("span", { text: label }),
        );
      chips.append(make("", "Todas"), ...categories.map((name) => make(name, name)));
    };

    const card = (item) => {
      const tag = (text, kind) => h(`span.conn__tag${kind ? `.is-${kind}` : ""}`, { text });
      return h(
        `article.conn${item.connected ? ".is-on" : ""}`,
        {},
        h(
          "div.conn__head",
          {},
          h("span.conn__name", { text: item.name }),
          item.connected
            ? h("span.conn__state", { text: "Conectado" })
            : h(
                "button.conn__link",
                { type: "button", onclick: () => linkConnector(item), text: "Conectar" },
              ),
        ),
        h(
          "div.conn__tags",
          {},
          h("span.conn__cat", { text: item.category }),
          item.can_read ? tag("Leitura", "read") : tag("Sem leitura neste plano", "off"),
          item.can_write
            ? tag("Escrita", "write")
            : tag(item.write_plan ? `Escrita no ${item.write_plan === "ultra" ? "Ultra" : "Pro"}` : "Só leitura", "off"),
          item.weight > 1 ? tag(`Usa ${item.weight}× o limite`, "cost") : null,
        ),
      );
    };

    // Ligar é informar o endereço MCP do serviço: o KAZER aperta a mão com ele
    // e só então guarda. Sem endereço que responda, não vira "Conectado".
    const linkConnector = (item) => {
      const url = h("input.set-field__input", {
        type: "url",
        placeholder: "https://… endereço MCP do serviço",
        "aria-label": "Endereço MCP",
        maxlength: "500",
      });
      const token = h("input.set-field__input", {
        type: "password",
        placeholder: "Opcional",
        "aria-label": "Credencial",
        autocomplete: "off",
        maxlength: "4000",
      });
      const status = h("p.set-note");
      const submit = h("button.pill-button.pill-button--solid", { type: "button", text: "Conectar" });
      submit.addEventListener("click", async () => {
        submit.disabled = true;
        status.textContent = "Falando com o serviço…";
        const result = await request("/api/connections", {
          method: "POST",
          body: {
            url: url.value.trim(),
            token: token.value,
            connector_id: item?.id,
            name: item?.name,
          },
        });
        submit.disabled = false;
        if (!result.ok) {
          status.textContent = CONNECT_ERRORS[result.data?.error] || result.data?.detail || "Não deu para conectar.";
          return;
        }
        const { closeSheet } = await import("./sheets.js");
        await closeSheet();
        toast(`${result.data.name} conectado: ${result.data.tools.length} ferramenta${result.data.tools.length === 1 ? "" : "s"}.`);
        load({ reset: true });
      });

      openSheet({
        title: item ? `Conectar ${item.name}` : "Conector personalizado",
        content: h(
          "div.conn__form",
          {},
          h("p.set-note", {
            text: "O KAZER fala com o serviço pelo protocolo MCP. A credencial fica só no servidor e nunca volta para o navegador.",
          }),
          h("label.set-field", {}, h("span.set-field__label", { text: "Endereço" }), url),
          h("label.set-field", {}, h("span.set-field__label", { text: "Credencial" }), token),
          status,
          h("div.pr__actions", {}, submit),
        ),
      });
      window.setTimeout(() => url.focus(), 120);
    };

    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        state.q = search.value.trim();
        load({ reset: true });
      }, 260);
    });
    more.addEventListener("click", () => load());
    load();

    return h(
      "div",
      {},
      this.group(
        "Conectar",
        h(
          "button.set-action.set-action--accent",
          { type: "button", onclick: () => linkConnector(null) },
          icon("plug"),
          h("span", { text: "Adicionar conector personalizado" }),
          icon("chevron-right"),
        ),
        h(
          "div.connectors.connectors--wide",
          {},
          h("span.connectors__icon", {}, icon("plug")),
          h("p.connectors__title", { id: "conn-count", text: "Nenhum conector conectado." }),
          h("p.connectors__text", {
            text: "O KAZER fala com qualquer serviço que tenha endereço MCP. Informe o endereço (e a credencial, se o serviço pedir) e as ferramentas dele passam a valer nas suas conversas. A credencial fica só no servidor.",
          }),
        ),
      ),
      this.group("Catálogo", h("label.set-field", {}, h("span.set-field__label", { text: "Buscar" }), search), chips, count, list, more),
    );
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
