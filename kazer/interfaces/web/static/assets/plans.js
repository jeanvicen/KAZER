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

// Milhar com ponto, como se escreve em português.
const num = (value) => Number(value || 0).toLocaleString("pt-BR");

export async function openPlans({ opener, highlight } = {}) {
  if (open) return open;
  // Estilo e dados juntos: a tela só aparece quando os dois chegam. Enquanto
  // isso, o Kazinho segura a espera (e some sozinho se ela for curta).
  const { createLoader } = await import("./loader.js");
  const waiting = createLoader(document.body, { label: "Preparando os planos…", full: true });
  waiting.start();
  const [result] = await Promise.all([request("/api/plans"), loadStyle("/assets/plans.css")]);
  waiting.stop();
  if (!result.ok) {
    toast("Não deu para carregar os planos agora.");
    return null;
  }
  open = new PlansScreen({ ...result.data, opener, highlight });
  return open;
}

class PlansScreen {
  constructor({ plans, usage, checkout, opener, highlight }) {
    this.plans = plans;
    this.usage = usage || {};
    this.checkout = Boolean(checkout);
    this.opener = opener;
    this.highlight = highlight;
    this.yearly = false;
    this.build();
  }

  build() {
    this.title = h("h2.plans__title", { id: "plans-title", tabindex: "-1" }, "Escolha seu ", h("strong", { text: "KAZER" }));
    this.closeButton = h(
      "button.icon-button.plans__close",
      { type: "button", "aria-label": "Fechar planos", onclick: () => this.close() },
      icon("close"),
    );

    // Abertura cinematográfica: a Fenda no centro com a luz passando por ela.
    this.stage = h(
      "div.plans__stage",
      { "aria-hidden": "true" },
      h("span.plans__glow"),
      h("span.plans__ring"),
      h("span.plans__ring.plans__ring--slow"),
      mark("plans__mark"),
    );

    this.cycle = this.buildCycle();
    this.grid = h("div.plans__grid");
    this.cards = this.plans.map((plan, index) => this.card(plan, index));
    this.grid.append(...this.cards.map((card) => card.root));

    this.foot = h(
      "footer.plans__foot",
      {},
      h("p.plans__note", {
        text: this.checkout
          ? "Você pode trocar ou cancelar quando quiser."
          : "A assinatura ainda não abriu. Deixe seu interesse e avisamos você assim que abrir — nada é cobrado agora.",
      }),
    );

    this.body = h("div.plans__body", {}, this.stage, h("p.plans__lede", { text: this.lede() }), this.cycle, this.grid, this.foot);
    this.panel = h(
      "div.plans__panel",
      { role: "dialog", "aria-modal": "true", "aria-labelledby": "plans-title" },
      h("header.plans__head", {}, this.title, this.closeButton),
      this.body,
    );
    this.root = h("div.plans", {}, h("div.plans__scrim", { onclick: () => this.close() }), this.panel);

    this.onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else trapFocus(this.panel, event);
    };
    document.addEventListener("keydown", this.onKey, true);
    document.body.append(this.root);
    const chat = document.getElementById("chat");
    if (chat) chat.inert = true;

    window.requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.title.focus({ preventScroll: true });
      if (!reducedMotion()) this.cards.forEach((card) => card.countUp());
      if (this.highlight) {
        const target = this.cards.find((card) => card.plan.id === this.highlight);
        target?.root.classList.add("is-wanted");
      }
    });
    announce("Planos do KAZER");
  }

  lede() {
    const current = this.plans.find((plan) => plan.id === this.usage.plan);
    if (!current) return "Mais uso, modo Forja e artefatos quando você precisar.";
    if (current.id === "free") return "Você está no plano gratuito. Veja o que muda quando o KAZER destrava.";
    return `Você está no ${current.name}. Veja tudo o que ele já te dá.`;
  }

  buildCycle() {
    // O anual só aparece quando algum plano cobra: no gratuito não faz sentido.
    if (!this.plans.some((plan) => plan.monthly_cents > 0)) return h("div", { hidden: true });
    const make = (label, yearly, extra) =>
      h(
        "button.plans__cycle-option",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(this.yearly === yearly),
          onclick: () => this.setCycle(yearly),
        },
        h("span", { text: label }),
        extra ? h("span.plans__save", { text: extra }) : null,
      );
    this.cycleMonthly = make("Mensal", false);
    this.cycleYearly = make("Anual", true, "2 meses grátis");
    return h("div.plans__cycle", { role: "radiogroup", "aria-label": "Forma de pagamento" }, this.cycleMonthly, this.cycleYearly);
  }

  setCycle(yearly) {
    if (this.yearly === yearly) return;
    this.yearly = yearly;
    this.cycleMonthly.setAttribute("aria-checked", String(!yearly));
    this.cycleYearly.setAttribute("aria-checked", String(yearly));
    for (const card of this.cards) card.setCycle(yearly);
  }

  card(plan, index) {
    const card = new PlanCard(plan, {
      index,
      current: plan.id === this.usage.plan,
      usage: this.usage,
      onChoose: () => this.choose(plan),
    });
    return card;
  }

  async choose(plan) {
    if (plan.monthly_cents === 0) {
      toast("Este já é o plano aberto a todo mundo.");
      return;
    }
    if (this.checkout) {
      // Quando a cobrança existir, é aqui que ela entra.
      toast("Abrindo o pagamento…");
      return;
    }
    const saved = await request("/api/settings", {
      method: "POST",
      body: { preferences: { wants_plan: plan.id } },
    });
    const body = h(
      "div.offer",
      {},
      h("p.offer__lead", { text: `Anotado: você quer o ${plan.name} por ${plan.monthly_price} por mês.` }),
      h("p.offer__text", {
        text: saved.ok
          ? "A assinatura ainda não abriu. Guardamos seu interesse na sua conta e avisamos no seu e-mail assim que der para pagar. Nada foi cobrado."
          : "A assinatura ainda não abriu e não deu para guardar seu interesse agora. Volte aqui quando a cobrança abrir — nada foi cobrado.",
      }),
    );
    openSheet({ title: "Quase lá", content: body, kind: "alert" });
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
  constructor(plan, { index, current, usage, onChoose }) {
    this.plan = plan;
    this.current = current;
    this.yearly = false;
    // No plano atual vale a franquia que o servidor informou: o catálogo é o
    // que o plano promete, mas o ambiente pode estar com outro limite.
    this.allowance = current && usage.allowance ? usage.allowance : plan.allowance;
    this.price = h("span.plan__price", { text: plan.monthly_price });
    this.per = h("span.plan__per", { text: plan.monthly_cents > 0 ? "/mês" : "para sempre" });
    this.hint = h("span.plan__hint", { text: "" });
    this.counter = h("strong.plan__units");

    const action = current
      ? h("div.plan__current", {}, icon("check"), h("span", { text: "Seu plano" }))
      : h(
          "button.plan__cta",
          { type: "button", onclick: onChoose },
          h("span", { text: plan.monthly_cents > 0 ? `Quero o ${plan.name}` : "Continuar no gratuito" }),
          icon("chevron-right"),
        );

    this.root = h(
      `article.plan${plan.featured ? ".is-featured" : ""}${current ? ".is-current" : ""}`,
      {},
      h("span.plan__sheen", { "aria-hidden": "true" }),
      plan.featured ? h("span.plan__badge", { text: "Mais escolhido" }) : null,
      h(
        "header.plan__head",
        {},
        h("span.plan__icon", { "aria-hidden": "true" }, icon(PLAN_ICONS[plan.id] || "sparkle")),
        h("h3.plan__name", { text: plan.name }),
        h("p.plan__tagline", { text: plan.tagline }),
      ),
      h("p.plan__pricing", {}, this.price, this.per),
      this.hint,
      h(
        "p.plan__meter",
        {},
        this.counter,
        h("span.plan__meter-label", {
          text: `unidades a cada ${(current && usage.window_hours) || plan.window_hours} h`,
        }),
      ),
      current && usage.allowance ? this.usageBar(usage) : null,
      h(
        "ul.plan__list",
        {},
        plan.highlights.map((text) =>
          h("li.plan__item", {}, icon("check", "plan__check"), h("span", { text })),
        ),
      ),
      plan.extras.length
        ? h("ul.plan__extras", {}, plan.extras.map((text) => h("li", {}, icon("plus", "plan__plus"), h("span", { text }))))
        : null,
      action,
    );
    // CSP bloqueia `style` em atributo: as variáveis vão pelo CSSOM.
    this.root.style.setProperty("--accent", plan.accent);
    this.root.style.setProperty("--i", String(index));
    for (const [i, item] of [...this.root.querySelectorAll(".plan__item")].entries()) {
      item.style.setProperty("--i", String(i));
    }
    this.counter.textContent = num(this.allowance);
    if (finePointer() && !reducedMotion()) this.enableTilt();
  }

  usageBar(usage) {
    const used = Math.min(usage.consumed || 0, usage.allowance);
    const pct = usage.allowance ? Math.round((used / usage.allowance) * 100) : 0;
    const fill = h("span.plan__bar-fill");
    const bar = h(
      "div.plan__usage",
      {},
      h(
        "div.plan__bar",
        { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(usage.allowance), "aria-valuenow": String(used) },
        fill,
      ),
      h("span.plan__usage-text", {
        text: usage.reset_at
          ? `${num(used)} de ${num(usage.allowance)} usadas · renova ${formatReset(usage.reset_at)}`
          : `${num(used)} de ${num(usage.allowance)} usadas nesta janela`,
      }),
    );
    window.requestAnimationFrame(() => fill.style.setProperty("--pct", `${pct}%`));
    return bar;
  }

  setCycle(yearly) {
    this.yearly = yearly;
    const plan = this.plan;
    if (plan.monthly_cents === 0) return;
    this.price.textContent = yearly ? plan.yearly_per_month : plan.monthly_price;
    this.per.textContent = "/mês";
    this.hint.textContent = yearly ? `${plan.yearly_price} cobrados uma vez por ano` : "";
    this.price.classList.remove("is-swapping");
    void this.price.offsetWidth;
    if (!reducedMotion()) this.price.classList.add("is-swapping");
  }

  // Contador que sobe rápido na entrada: dá peso ao número sem enrolar.
  countUp() {
    const target = this.allowance;
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      // Desacelera no fim (easeOutCubic).
      const eased = 1 - (1 - t) ** 3;
      this.counter.textContent = num(Math.round(target * eased));
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  enableTilt() {
    const limit = 5;
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
        h("p.limit__offer-text", { text: `${upgrade.price} por mês. Modo Forja, artefatos e pesquisa profunda junto.` }),
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
