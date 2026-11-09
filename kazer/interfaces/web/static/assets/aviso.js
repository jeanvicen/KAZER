// Painel do dono no navegador: tela de manutenção e aviso global.
//
// Quem decide é o arquivo `controle-de-notificacao/controle.yaml` no servidor;
// aqui só se mostra o que `/api/status` responde. O servidor também recusa as
// APIs durante a manutenção (503 `maintenance`), então esconder esta tela pelo
// DevTools não libera nada.
//
// - Consulta ao abrir, a cada 90 s, ao voltar para a aba e quando qualquer
//   chamada da API responde `maintenance` (evento `kazer:maintenance`).
// - Todo texto do dono entra por textContent (CSP sem estilo inline).
// - "Fechar" o aviso fica guardado neste navegador só para aquele `id`.

import { h, icon, mark, store } from "./dom.js";
import { t } from "./i18n.js";

const POLL_MS = 90_000;
const DISMISS_KEY = "kazer:aviso-fechado";
const ICONS = { info: "info", sucesso: "check", aviso: "bolt", urgente: "shield" };

let overlay = null;
let banner = null;
let lastFocus = null;
let timer = 0;
let inflight = null;

function safeLink(value) {
  if (typeof value !== "string" || !value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return /^https:\/\/\S+$/i.test(value) ? value : "";
}

// ---------------------------------------------------------------------------
// Manutenção: tela cheia, o resto da página fica inerte.
// ---------------------------------------------------------------------------

function setInert(on) {
  for (const el of document.body.children) {
    if (el === overlay || el.tagName === "SCRIPT") continue;
    if (on) {
      if (!el.inert) {
        el.inert = true;
        el.dataset.kzInert = "1";
      }
    } else if (el.dataset.kzInert) {
      el.inert = false;
      delete el.dataset.kzInert;
    }
  }
}

function showMaintenance(info) {
  if (!overlay) {
    lastFocus = document.activeElement;
    const retry = h("button.kz-maint__retry", { type: "button", onclick: () => refresh(true) }, t("Tentar de novo"));
    overlay = h(
      "section.kz-maint",
      { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "kz-maint-title", "aria-describedby": "kz-maint-body" },
      h(
        "div.kz-maint__card",
        {},
        mark("kz-maint__mark"),
        h("p.kz-maint__badge", {}, h("span.kz-maint__dot", { "aria-hidden": "true" }), t("Manutenção")),
        h("h1.kz-maint__title#kz-maint-title", { tabindex: "-1" }),
        h("p.kz-maint__body#kz-maint-body"),
        h("p.kz-maint__eta"),
        retry,
        h("p.kz-maint__note", {}, t("Esta tela some sozinha quando o KAZER voltar.")),
      ),
    );
    document.body.append(overlay);
    document.documentElement.classList.add("kz-in-maint");
    overlay.querySelector(".kz-maint__title").focus({ preventScroll: true });
  }
  overlay.querySelector(".kz-maint__title").textContent = info.titulo || "Estamos em manutenção";
  overlay.querySelector(".kz-maint__body").textContent = info.mensagem || "";
  const eta = overlay.querySelector(".kz-maint__eta");
  eta.textContent = info.previsao || "";
  eta.hidden = !info.previsao;
  setInert(true);
}

function hideMaintenance() {
  if (!overlay) return;
  setInert(false);
  overlay.remove();
  overlay = null;
  document.documentElement.classList.remove("kz-in-maint");
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Aviso global: cartão no topo, fechável quando o dono permitir.
// ---------------------------------------------------------------------------

function dismissed(id) {
  const list = store.get(DISMISS_KEY, []);
  return Array.isArray(list) && list.includes(id);
}

function dismiss(id) {
  const list = store.get(DISMISS_KEY, []);
  const next = (Array.isArray(list) ? list : []).filter((item) => item !== id).slice(-19);
  next.push(id);
  store.set(DISMISS_KEY, next);
  hideNotice();
}

function hideNotice() {
  banner?.remove();
  banner = null;
}

function showNotice(notice) {
  if (!notice || (notice.pode_fechar && dismissed(notice.id))) return hideNotice();
  const key = JSON.stringify(notice);
  if (banner?.dataset.key === key) return;
  hideNotice();
  const kind = ICONS[notice.tipo] ? notice.tipo : "info";
  const link = safeLink(notice.botao_link);
  const external = link.startsWith("https://");
  banner = h(
    "aside.kz-notice",
    {
      role: kind === "urgente" ? "alert" : "status",
      "aria-label": t("Aviso do KAZER"),
      dataset: { kind, key },
    },
    h("span.kz-notice__icon", {}, icon(ICONS[kind])),
    h(
      "div.kz-notice__text",
      {},
      notice.titulo ? h("strong.kz-notice__title", { text: notice.titulo }) : null,
      notice.mensagem ? h("p.kz-notice__body", { text: notice.mensagem }) : null,
      link && notice.botao_texto
        ? h(
            "a.kz-notice__action",
            external
              ? { href: link, target: "_blank", rel: "noopener noreferrer", text: notice.botao_texto }
              : { href: link, text: notice.botao_texto },
          )
        : null,
    ),
    notice.pode_fechar
      ? h(
          "button.kz-notice__close",
          { type: "button", "aria-label": t("Fechar aviso"), onclick: () => dismiss(notice.id) },
          icon("close"),
        )
      : null,
  );
  document.body.append(banner);
}

// ---------------------------------------------------------------------------
// Consulta ao servidor
// ---------------------------------------------------------------------------

async function refresh(manual = false) {
  if (inflight) return inflight;
  const button = overlay?.querySelector(".kz-maint__retry");
  if (manual && button) button.disabled = true;
  inflight = (async () => {
    try {
      const response = await fetch(`/api/status?t=${Date.now()}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      const maint = data?.manutencao;
      if (maint?.ativa && !maint.liberado) showMaintenance(maint);
      else hideMaintenance();
      showNotice(maint?.ativa && !maint.liberado ? null : data?.aviso);
    } catch {
      /* sem rede: mantém o que já está na tela */
    } finally {
      inflight = null;
      if (button?.isConnected) button.disabled = false;
    }
  })();
  return inflight;
}

export function startControl() {
  refresh();
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  window.addEventListener("kazer:maintenance", () => refresh());
  window.addEventListener("online", () => refresh());
}
