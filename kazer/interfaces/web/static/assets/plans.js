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

import { announce, finePointer, formatReset, h, icon, loadStyle, mark, reducedMotion, trapFocus } from "./dom.js";
import { request } from "./net.js";
import { openSheet, toast } from "./sheets.js";

let open = null;

const PLAN_ICONS = { free: "sparkle", pro: "bolt", ultra: "crown" };

// O que o plano pago muda, em linguagem de quem programa (não de tabela).
const VALUE = [
  ["file", "KZ Code", "Projetos inteiros, em pastas, num .zip pronto para rodar."],
  ["globe", "Pesquisa ao vivo", "Documentação, GitHub e a web consultados enquanto ele pensa."],
  ["research", "PDFs e slides", "Relatórios e apresentações bonitos, prontos para enviar."],
  ["bolt", "Muito mais uso", "Sessões longas sem bater no limite no meio do projeto."],
];

const FAQ = [
  ["Posso cancelar quando quiser?", "Sim. Sem fidelidade e sem multa: cancelou, o plano vale até o fim do período pago."],
  ["O que acontece com minhas conversas?", "Nada muda. Tudo o que você já fez continua na sua conta, em qualquer plano."],
  ["Qual a diferença entre Pro e Ultra?", "O Ultra tem muito mais uso por janela e pensamento profundo sem custo dobrado — para quem programa o dia inteiro."],
];

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

class PlansScreen {
  constructor({ plans, usage, checkout, opener, highlight }) {
    this.all = plans;
    this.plans = plans.filter((plan) => plan.monthly_cents > 0);
    this.free = plans.find((plan) => plan.id === "free");
    this.usage = usage || {};
    this.checkout = Boolean(checkout);
    this.opener = opener;
    this.highlight = highlight || "pro";
    this.yearly = false;
    this.build();
  }

  build() {
    this.closeButton = h(
      "button.icon-button.plans__close",
      { type: "button", "aria-label": "Fechar planos", onclick: () => this.close() },
      icon("close"),
    );
    const current = this.all.find((plan) => plan.id === this.usage.plan);

    this.stage = h(
      "div.plans__hero",
      {},
      h(
        "div.plans__orb",
        { "aria-hidden": "true" },
        h("span.plans__orb-glow"),
        h("span.plans__orb-ring"),
        h("span.plans__orb-ring.plans__orb-ring--2"),
        mark("plans__mark"),
      ),
      h("span.plans__eyebrow", { text: "KAZER Pro · KAZER Ultra" }),
      h("h2.plans__title", { id: "plans-title", tabindex: "-1" }, "Destrave o KAZER ", h("em", { text: "inteiro." })),
      h("p.plans__lede", {
        text:
          current && current.monthly_cents > 0
            ? `Você já está no ${current.name}. Veja tudo o que ele te dá — ou suba de nível.`
            : "Do prompt ao projeto pronto: KZ Code, pesquisa ao vivo, PDFs e slides, e uso de sobra para construir o dia todo.",
      }),
    );

    this.cycle = this.buildCycle();
    this.grid = h("div.plans__grid");
    this.cards = this.plans.map((plan, index) => new PlanCard(plan, {
      index,
      free: this.free,
      current: plan.id === this.usage.plan,
      highlighted: plan.id === this.highlight,
      onChoose: (button) => this.choose(plan, button),
    }));
    this.grid.append(...this.cards.map((card) => card.root));

    const value = h(
      "section.plans__value",
      { "aria-label": "O que muda" },
      VALUE.map(([iconName, title, text], index) => {
        const item = h("div.plans__value-item", {}, h("span.plans__value-icon", {}, icon(iconName)), h("strong", { text: title }), h("span", { text }));
        item.style.setProperty("--i", String(index));
        return item;
      }),
    );
    const faq = h(
      "section.plans__faq",
      { "aria-label": "Perguntas frequentes" },
      FAQ.map(([q, a]) => h("details.plans__q", {}, h("summary", {}, h("span", { text: q }), icon("chevron")), h("p", { text: a }))),
    );
    this.foot = h(
      "footer.plans__foot",
      {},
      h("p.plans__trust", {}, icon("shield"), h("span", { text: "Pagamento seguro · Cancele quando quiser · Sem fidelidade" })),
      this.checkout ? null : h("p.plans__note", { text: "A assinatura abre em breve: deixe seu interesse e avisamos você primeiro. Nada é cobrado agora." }),
    );

    this.body = h("div.plans__body", {}, this.stage, this.cycle, this.grid, value, faq, this.foot);
    this.panel = h(
      "div.plans__panel",
      { role: "dialog", "aria-modal": "true", "aria-labelledby": "plans-title" },
      h("header.plans__head", {}, h("span.plans__brand", {}, mark("plans__brand-mark"), h("span", { text: "Planos" })), this.closeButton),
      this.body,
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

    window.requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.title?.focus?.({ preventScroll: true });
      this.panel.querySelector("#plans-title")?.focus({ preventScroll: true });
      if (!reducedMotion()) this.cards.forEach((card) => card.countUp());
    });
    announce("Planos do KAZER");
  }

  buildCycle() {
    const make = (label, yearly, extra) =>
      h(
        "button.plans__cycle-option",
        { type: "button", role: "radio", "aria-checked": String(this.yearly === yearly), onclick: () => this.setCycle(yearly) },
        h("span", { text: label }),
        extra ? h("span.plans__save", { text: extra }) : null,
      );
    this.cycleMonthly = make("Mensal", false);
    this.cycleYearly = make("Anual", true, "2 meses grátis");
    this.cycleThumb = h("span.plans__cycle-thumb", { "aria-hidden": "true" });
    return h("div.plans__cycle", { role: "radiogroup", "aria-label": "Forma de pagamento" }, this.cycleThumb, this.cycleMonthly, this.cycleYearly);
  }

  setCycle(yearly) {
    if (this.yearly === yearly) return;
    this.yearly = yearly;
    this.cycleMonthly.setAttribute("aria-checked", String(!yearly));
    this.cycleYearly.setAttribute("aria-checked", String(yearly));
    this.cycle.classList.toggle("is-yearly", yearly);
    for (const card of this.cards) card.setCycle(yearly);
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
      h("p.offer__lead", { text: `Seu lugar no ${plan.name} (${price}) está guardado.` }),
      h("p.offer__text", {
        text: saved.ok
          ? "A assinatura abre em breve. Você é avisado primeiro, no seu e-mail — e nada foi cobrado."
          : "A assinatura abre em breve e não deu para guardar seu interesse agora. Volte aqui quando abrir — nada foi cobrado.",
      }),
    );
    openSheet({ title: "Você está na lista", content: body, kind: "alert" });
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

class PlanCard {
  constructor(plan, { index, free, current, highlighted, onChoose }) {
    this.plan = plan;
    this.yearly = false;
    this.cents = plan.monthly_cents;
    this.price = h("span.plan__price");
    this.per = h("span.plan__per", { text: "/mês" });
    this.hint = h("span.plan__hint", { text: "Cobrado todo mês" });
    // Quanto mais uso que o gratuito — proporção, nunca o número do limite.
    const times = free?.allowance ? Math.round(plan.allowance / free.allowance) : 0;

    const cta = current
      ? h("div.plan__current", {}, icon("check"), h("span", { text: "Seu plano atual" }))
      : h(
          "button.plan__cta",
          { type: "button", onclick: (event) => onChoose(event.currentTarget) },
          h("span.plan__cta-shine", { "aria-hidden": "true" }),
          h("span", { text: `Assinar o ${plan.name}` }),
          icon("chevron-right"),
        );

    this.root = h(
      `article.plan${plan.featured ? ".is-featured" : ""}${highlighted ? ".is-wanted" : ""}${current ? ".is-current" : ""}`,
      {},
      h("span.plan__border", { "aria-hidden": "true" }),
      h("span.plan__sheen", { "aria-hidden": "true" }),
      plan.featured ? h("span.plan__badge", { text: "Mais escolhido" }) : h("span.plan__badge.plan__badge--quiet", { text: "Para quem vive de código" }),
      h(
        "header.plan__head",
        {},
        h("span.plan__icon", { "aria-hidden": "true" }, icon(PLAN_ICONS[plan.id] || "sparkle")),
        h("h3.plan__name", { text: plan.name }),
        h("p.plan__tagline", { text: plan.tagline }),
      ),
      h("p.plan__pricing", {}, this.price, this.per),
      this.hint,
      times > 1 ? h("p.plan__boost", {}, icon("bolt"), h("span", { text: `${times}× mais uso que o gratuito` })) : null,
      cta,
      h(
        "ul.plan__list",
        {},
        plan.highlights
          .filter((text) => !/unidade|vezes o uso|\d+ vezes/i.test(text))
          .map((text, i) => {
            const item = h("li.plan__item", {}, icon("check", "plan__check"), h("span", { text }));
            item.style.setProperty("--i", String(i));
            return item;
          }),
        plan.extras.map((text) => h("li.plan__item.plan__item--extra", {}, icon("plus", "plan__check"), h("span", { text }))),
      ),
    );
    this.root.style.setProperty("--accent", plan.accent);
    this.root.style.setProperty("--i", String(index));
    this.paintPrice(this.cents);
    if (finePointer() && !reducedMotion()) this.enableTilt();
  }

  paintPrice(cents) {
    const reais = Math.floor(cents / 100);
    const centavos = String(cents % 100).padStart(2, "0");
    this.price.replaceChildren(h("small", { text: "R$" }), h("b", { text: reais.toLocaleString("pt-BR") }), h("small", { text: `,${centavos}` }));
  }

  setCycle(yearly) {
    this.yearly = yearly;
    const plan = this.plan;
    this.cents = yearly ? Math.round(plan.yearly_cents / 12) : plan.monthly_cents;
    this.paintPrice(this.cents);
    this.hint.textContent = yearly ? `${plan.yearly_price} cobrados uma vez por ano` : "Cobrado todo mês";
    this.price.classList.remove("is-swapping");
    void this.price.offsetWidth;
    if (!reducedMotion()) this.price.classList.add("is-swapping");
  }

  // Preço que sobe rápido na entrada: dá peso ao número sem enrolar.
  countUp() {
    const target = this.cents;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / 900, 1);
      this.paintPrice(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  enableTilt() {
    const limit = 4;
    this.root.addEventListener("pointermove", (event) => {
      const box = this.root.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      this.root.style.setProperty("--tilt-x", `${(-y * limit).toFixed(2)}deg`);
      this.root.style.setProperty("--tilt-y", `${(x * limit).toFixed(2)}deg`);
      this.root.style.setProperty("--shine-x", `${((x + 0.5) * 100).toFixed(1)}%`);
    });
    this.root.addEventListener("pointerleave", () => {
      this.root.style.setProperty("--tilt-x", "0deg");
      this.root.style.setProperty("--tilt-y", "0deg");
    });
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
