// Folhas inferiores (celular) / painéis flutuantes (desktop), diálogos de
// confirmação e avisos rápidos. Esc fecha, foco fica preso dentro e volta a
// quem abriu, arrastar para baixo fecha no toque. O fundo fica `inert`.

import { focusables, h, icon, reducedMotion, trapFocus } from "./dom.js";

let current = null;
let background = null;

// Elemento que fica inerte (sem foco nem leitura) enquanto uma folha está aberta.
export function setSheetBackground(element) {
  background = element;
}

export function closeSheet() {
  return current ? current.close() : Promise.resolve();
}

export function sheetOpen() {
  return current !== null;
}

export function openSheet({ title, content, opener = document.activeElement, kind = "sheet", onClose, back }) {
  if (current) current.close({ restore: false });
  const titleId = `sheet-${Math.random().toString(36).slice(2, 8)}`;
  const body = h("div.sheet__body");
  const closeButton = h("button.icon-button.sheet__close", { type: "button", "aria-label": "Fechar" }, icon("close"));
  const head = h(
    "header.sheet__head",
    {},
    back ? h("button.icon-button.sheet__back", { type: "button", "aria-label": "Voltar", onclick: () => back() }, icon("back")) : null,
    h("h2.sheet__title", { id: titleId, text: title }),
    closeButton,
  );
  const panel = h(
    `section.sheet.sheet--${kind}`,
    { role: kind === "alert" ? "alertdialog" : "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    kind === "sheet" ? h("div.sheet__grab", { "aria-hidden": "true" }) : null,
    head,
    body,
  );
  const scrim = h("div.layer__scrim");
  const layer = h(`div.layer.layer--${kind}`, {}, scrim, panel);

  let closed = false;
  const handle = {
    panel,
    body,
    close({ restore = true } = {}) {
      if (closed) return Promise.resolve();
      closed = true;
      if (current === handle) current = null;
      document.removeEventListener("keydown", onKey, true);
      layer.classList.remove("is-open");
      if (background && !current) background.inert = false;
      if (restore && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      onClose?.();
      return new Promise((resolve) => {
        window.setTimeout(() => {
          layer.remove();
          resolve();
        }, reducedMotion() ? 0 : 260);
      });
    },
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
    } else {
      trapFocus(panel, event);
    }
  };

  body.append(typeof content === "function" ? content(handle) : content);
  closeButton.addEventListener("click", () => handle.close());
  scrim.addEventListener("click", () => handle.close());
  document.addEventListener("keydown", onKey, true);
  enableDrag(panel, handle);

  document.body.append(layer);
  if (background) background.inert = true;
  current = handle;
  window.requestAnimationFrame(() => {
    layer.classList.add("is-open");
    const first = focusables(body)[0];
    (first || panel).focus({ preventScroll: true });
  });
  return handle;
}

// Arrastar a folha para baixo fecha (só toque, só na alça/cabeçalho).
function enableDrag(panel, handle) {
  let startY = 0;
  let dy = 0;
  let dragging = false;
  panel.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || !event.target.closest(".sheet__grab, .sheet__head")) return;
    if (event.target.closest("button")) return;
    dragging = true;
    startY = event.clientY;
    dy = 0;
    panel.setPointerCapture(event.pointerId);
    panel.classList.add("is-dragging");
  });
  panel.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dy = Math.max(0, event.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    if (dy > Math.min(140, panel.offsetHeight * 0.3)) handle.close();
  };
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
}

// Confirmação com ação destrutiva explícita. Resolve true/false.
export function confirmDialog({ title, body, confirm = "Confirmar", danger = false, opener }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value, handle) => {
      if (answered) return;
      answered = true;
      resolve(value);
      handle?.close();
    };
    openSheet({
      title,
      kind: "alert",
      opener,
      onClose: () => finish(false),
      content: (handle) =>
        h(
          "div.confirm",
          {},
          h("p.confirm__body", { text: body }),
          h(
            "div.confirm__actions",
            {},
            h("button.pill-button", { type: "button", text: "Cancelar", onclick: () => finish(false, handle) }),
            h(`button.pill-button.pill-button--solid${danger ? ".pill-button--danger" : ""}`, {
              type: "button",
              text: confirm,
              onclick: () => finish(true, handle),
            }),
          ),
        ),
    });
  });
}

// Pergunta curta com um campo de texto (por exemplo, renomear conversa).
export function promptDialog({ title, label, value = "", confirm = "Salvar", maxLength = 80, opener }) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h("input.field__input", { type: "text", value, maxlength: String(maxLength), "aria-label": label });
    const finish = (result, handle) => {
      if (answered) return;
      answered = true;
      resolve(result);
      handle?.close();
    };
    openSheet({
      title,
      kind: "alert",
      opener,
      onClose: () => finish(null),
      content: (handle) => {
        const form = h(
          "form.confirm",
          { novalidate: true },
          input,
          h(
            "div.confirm__actions",
            {},
            h("button.pill-button", { type: "button", text: "Cancelar", onclick: () => finish(null, handle) }),
            h("button.pill-button.pill-button--solid", { type: "submit", text: confirm }),
          ),
        );
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const text = input.value.trim();
          if (text) finish(text, handle);
          else input.focus();
        });
        window.requestAnimationFrame(() => input.select());
        return form;
      },
    });
  });
}

// ---------- Avisos rápidos ----------

let toastHost = null;

export function toast(text, { action, duration = 4200, tone = "" } = {}) {
  if (!toastHost) {
    toastHost = h("div.toasts", { role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const item = h(
    `div.toast${tone ? `.toast--${tone}` : ""}`,
    {},
    h("span.toast__text", { text }),
    action
      ? h("button.toast__action", {
          type: "button",
          text: action.label,
          onclick: () => {
            action.run();
            dismiss();
          },
        })
      : null,
  );
  let timer = 0;
  function dismiss() {
    window.clearTimeout(timer);
    item.classList.remove("is-in");
    window.setTimeout(() => item.remove(), 240);
  }
  toastHost.append(item);
  while (toastHost.children.length > 3) toastHost.firstElementChild.remove();
  window.requestAnimationFrame(() => item.classList.add("is-in"));
  timer = window.setTimeout(dismiss, duration);
  return dismiss;
}
