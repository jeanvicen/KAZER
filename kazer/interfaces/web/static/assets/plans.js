// Planos do KAZER: a tela que explica o que cada plano dá e a mensagem que
// aparece quando o limite acaba.
//
// Carregado sob demanda (ninguém baixa isto só para conversar). O catálogo e o
// uso vêm do servidor — nada de preço ou franquia escrito aqui, para a tela não
// contar uma história diferente da do banco.
//
// Honestidade: a cobrança ainda não está ligada. A tela mostra os preços
// anunciados e diz que a assinatura abre em breve, em vez de simular uma compra
// que não acontece.

import { announce, formatReset, h, icon, loadStyle, mark, reducedMotion, trapFocus } from "./dom.js";
import { request } from "./net.js";
import { openSheet, toast } from "./sheets.js";

let open = null;


// Abre a vitrine. Só mostra planos pagos: quem está no gratuito já está nele.
export async function openPlans({ opener, highlight } = {}) {
  if (open) return open;
  const { createLoader } = await import("./loader.js");
  const waiting = createLoader(document.body, { label: "Preparando os planos…", full: true });
  waiting.start();
  let result = { ok: false };
  let styled = false;
  try {
    [result] = await Promise.all([request("/api/plans"), loadStyle("/assets/plans.css").then(() => (styled = true))]);
    // Rede instável no celular: uma segunda tentativa antes de desistir.
    if (!result.ok) result = await request("/api/plans");
  } finally {
    waiting.stop();
  }
  if (!result.ok || !styled || !Array.isArray(result.data?.plans)) {
    toast("Não deu para carregar os planos agora. Confira a conexão e tente de novo.");
    return null;
  }
  open = new PlansScreen({ ...result.data, opener, highlight });
  return open;
}

// Ícones dos benefícios, na ordem em que o catálogo do servidor lista.
const PERK_ICONS = ["sparkle", "bolt", "file", "research", "globe", "crown"];

class PlansScreen {
  constructor({ plans, usage, checkout, opener, highlight }) {
    this.plans = plans.filter((plan) => plan.monthly_cents > 0);
    this.free = plans.find((plan) => plan.id === "free");
    this.usage = usage || {};
    this.checkout = Boolean(checkout);
    this.opener = opener;
    this.selected = this.plans.find((plan) => plan.id === highlight) || this.plans.find((plan) => plan.featured) || this.plans[0];
    this.yearly = true;
    this.build();
  }

  build() {
    this.closeButton = h(
      "button.icon-button.plans__close",
      { type: "button", "aria-label": "Fechar planos", onclick: () => this.close() },
      icon("close"),
    );
    this.heading = h("h2.plans__title", { id: "plans-title", tabindex: "-1" });
    this.tagline = h("p.plans__lede");
    this.tabs = h(
      "div.plans__tabs",
      { role: "tablist", "aria-label": "Plano" },
      this.plans.map((plan) =>
        h("button.plans__tab", {
          type: "button",
          role: "tab",
          dataset: { plan: plan.id },
          text: plan.name.replace(/^KAZER\s+/, ""),
          onclick: () => this.select(plan),
        }),
      ),
    );
    this.perks = h("ul.plans__perks");
    this.options = h("div.plans__options", { role: "radiogroup", "aria-label": "Cobrança" });
    this.cta = h("button.plans__cta", { type: "button", onclick: (event) => this.choose(this.selected, event.currentTarget) });
    this.ctaNote = h("p.plans__cta-note");

    this.body = h(
      "div.plans__body",
      {},
      h("div.plans__brand", { "aria-hidden": "true" }, mark("plans__mark")),
      this.heading,
      this.tagline,
      this.tabs,
      this.perks,
      this.options,
    );
    this.panel = h(
      "div.plans__panel",
      { role: "dialog", "aria-modal": "true", "aria-labelledby": "plans-title" },
      h("header.plans__head", {}, h("span"), this.closeButton),
      this.body,
      h("footer.plans__bar", {}, this.cta, this.ctaNote),
    );
    this.root = h("div.plans", {}, h("div.plans__scrim", { onclick: () => this.close() }), this.panel);

    this.onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else trapFocus(this.panel, event);
    };
    document.addEventListener("keydown", this.onKey, true);
    document.body.append(this.root);
    const chat = document.getElementById("chat");
    if (chat) chat.inert = true;
    this.select(this.selected);
    window.requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.heading.focus({ preventScroll: true });
    });
    announce("Planos do KAZER");
  }

  select(plan) {
    this.selected = plan;
    for (const tab of this.tabs.children) tab.setAttribute("aria-selected", String(tab.dataset.plan === plan.id));
    this.panel.style.setProperty("--accent", plan.accent || "#e8b04a");
    this.heading.textContent = plan.name;
    this.tagline.textContent = plan.tagline;
    const times = this.free?.allowance ? Math.round(plan.allowance / this.free.allowance) : 0;
    const perks = [
      times > 1 ? `${times}× o uso do plano gratuito` : null,
      ...plan.highlights.filter((text) => !/plano gratuito|vezes o uso|\d+ vezes|Tudo do/i.test(text)),
      ...plan.extras,
    ].filter(Boolean);
    this.perks.replaceChildren(
      ...perks.map((text, index) => {
        const item = h("li.plans__perk", {}, h("span.plans__perk-icon", {}, icon(PERK_ICONS[index % PERK_ICONS.length])), h("span", { text }));
        item.style.setProperty("--i", String(index));
        return item;
      }),
    );
    this.paintOptions();
  }

  paintOptions() {
    const plan = this.selected;
    const saving = plan.monthly_cents ? Math.round((1 - plan.yearly_cents / 12 / plan.monthly_cents) * 100) : 0;
    const option = (yearly) =>
      h(
        "button.plans__option",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(this.yearly === yearly),
          onclick: () => {
            this.yearly = yearly;
            this.paintOptions();
          },
        },
        h("span.plans__radio", { "aria-hidden": "true" }),
        h(
          "span.plans__option-text",
          {},
          h("span.plans__option-name", {}, h("span", { text: yearly ? "Anual" : "Mensal" }), yearly && saving > 0 ? h("span.plans__save", { text: `Economize ${saving}%` }) : null),
          h("span.plans__option-sub", { text: yearly ? `${plan.yearly_price} por ano` : "Cobrado todo mês" }),
        ),
        h("span.plans__option-price", {}, h("strong", { text: yearly ? plan.yearly_per_month : plan.monthly_price }), h("span", { text: "/mês" })),
      );
    this.options.replaceChildren(option(true), option(false));
    const current = plan.id === this.usage.plan;
    this.cta.disabled = current;
    this.cta.textContent = current ? "Este já é o seu plano" : `Continuar com ${plan.name}`;
    this.ctaNote.textContent = this.checkout
      ? "Cancele quando quiser."
      : "As assinaturas abrem em breve. Nada é cobrado agora.";
  }

  async choose(plan, button) {
    const cycle = this.yearly ? "anual" : "mensal";
    if (this.checkout) {
      // Cobrança ligada: o servidor cria a sessão de pagamento e devolve o link.
      button.disabled = true;
      button.classList.add("is-busy");
      const result = await request("/api/checkout", { method: "POST", body: { plan: plan.id, cycle } });
      if (result.ok && typeof result.data?.url === "string" && result.data.url.startsWith("https://")) {
        window.location.assign(result.data.url);
        return;
      }
      button.disabled = false;
      button.classList.remove("is-busy");
      toast("Não deu para abrir o pagamento agora. Tente de novo em instantes.");
      return;
    }
    const saved = await request("/api/settings", { method: "POST", body: { preferences: { wants_plan: plan.id } } });
    const price = this.yearly ? `${plan.yearly_price} por ano` : `${plan.monthly_price} por mês`;
    const body = h(
      "div.offer",
      {},
      h("p.offer__lead", { text: `${plan.name}, ${price}.` }),
      h("p.offer__text", {
        text: saved.ok
          ? "Vamos avisar no seu e-mail quando a assinatura abrir. Nada foi cobrado."
          : "Não foi possível salvar agora. Tente de novo em instantes. Nada foi cobrado.",
      }),
    );
    openSheet({ title: "Interesse registrado", content: body, kind: "alert" });
  }

  close() {
    document.removeEventListener("keydown", this.onKey, true);
    this.root.classList.remove("is-open");
    const chat = document.getElementById("chat");
    if (chat) chat.inert = false;
    window.setTimeout(() => this.root.remove(), reducedMotion() ? 0 : 320);
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    open = null;
  }
}

// ---------- Limite acabou ----------

// Mostrada quando o servidor recusa por cota. Diz a verdade (quanto, quando
// libera) e deixa o caminho do upgrade a um toque.
export async function limitReached(data, { opener } = {}) {
  await loadStyle("/assets/plans.css");
  const upgrade = data.upgrade;
  const resets = data.reset_at ? `Libera de novo ${formatReset(data.reset_at)}.` : "";
  const body = h("div.limit", {});

  body.append(
    h("div.limit__art", { "aria-hidden": "true" }, h("span.limit__pulse"), mark("limit__mark")),
    h("p.limit__lead", { text: "Seu limite desta janela acabou." }),
    h("p.limit__reset", { text: resets || "Ele volta sozinho depois de um tempo." }),
  );

  if (upgrade) {
    body.append(
      h(
        "div.limit__offer",
        {},
        h("p.limit__offer-title", { text: `No ${upgrade.name} você teria ${upgrade.times}× esse limite.` }),
        h("p.limit__offer-text", { text: `${upgrade.price} por mês. KZ Code, artefatos e pesquisa profunda junto.` }),
        h(
          "button.limit__cta",
          {
            type: "button",
            onclick: async () => {
              const { closeSheet } = await import("./sheets.js");
              closeSheet();
              openPlans({ opener, highlight: upgrade.id });
            },
          },
          h("span", { text: `Ver o ${upgrade.name}` }),
          icon("chevron-right"),
        ),
      ),
    );
  }

  openSheet({ title: "Chegou no limite", content: body, kind: "alert", opener });
}
