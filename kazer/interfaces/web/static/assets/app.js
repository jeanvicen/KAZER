// Tela de entrada do KAZER: orquestra a abertura, os modos de autenticação e a
// cena digital. Toda decisão de autenticação acontece no servidor; o navegador
// nunca guarda senha nem token (o cookie de sessão é HttpOnly).

import { playIntro } from "./intro.js";
import { startScene } from "./scene.js";

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const DISPLAY_FONT = '"Grenze Gotisch", Georgia, serif';

const $ = (id) => document.getElementById(id);
const ui = {
  intro: $("intro"),
  formView: $("form-view"),
  modes: $("modes"),
  tabs: [$("tab-signin"), $("tab-signup")],
  heading: $("heading"),
  headingTitle: $("heading-title"),
  headingLede: $("heading-lede"),
  form: $("auth-form"),
  email: $("email"),
  password: $("password"),
  confirm: $("confirm"),
  hint: $("password-hint"),
  alert: $("form-alert"),
  alertText: $("form-alert-text"),
  alertAction: $("form-alert-action"),
  submit: $("submit"),
  submitLabel: $("submit-label"),
  forgot: $("forgot"),
  switchLink: $("switch"),
  note: $("privacy-note"),
  availability: $("availability"),
  notice: $("notice"),
  noticeTitle: $("notice-title"),
  noticeBody: $("notice-body"),
  noticeStatus: $("notice-status"),
  noticeActions: $("notice-actions"),
  scene: $("scene-canvas"),
};
const fields = {
  email: ui.form.querySelector('[data-field="email"]'),
  password: ui.form.querySelector('[data-field="password"]'),
  confirm: ui.form.querySelector('[data-field="confirm"]'),
};

// ---------- Textos ----------

const MODES = {
  signin: {
    fields: ["email", "password"],
    autocomplete: "current-password",
    submit: "Continue",
  },
  signup: {
    fields: ["email", "password", "confirm"],
    autocomplete: "new-password",
    submit: "Continue",
  },
  recover: {
    fields: ["email"],
    submit: "Send reset link",
    title: "Reset your password",
    lede: "Enter the email for your account. If it exists, we'll send a link to choose a new password.",
  },
  reset: {
    fields: ["password", "confirm"],
    autocomplete: "new-password",
    submit: "Update password",
    title: "Choose a new password",
    lede: "This signs you out on every device.",
  },
};

const FIELD_ERRORS = {
  invalid_email: ["email", "Enter a valid email address."],
  password_too_short: ["password", "Use at least 10 characters."],
  password_too_long: ["password", "Use 128 characters or fewer."],
  password_too_common: ["password", "This password is too easy to guess. Try a longer phrase."],
};

function waitText(seconds) {
  if (!seconds) return "Too many attempts. Wait a moment and try again.";
  const minutes = Math.ceil(seconds / 60);
  return seconds < 90
    ? `Too many attempts. Try again in ${seconds} seconds.`
    : `Too many attempts. Try again in ${minutes} minutes.`;
}

function generalError(result) {
  const code = result.data.error;
  if (code === "network") return "Can't reach KAZER. Check your connection and try again.";
  if (code === "rate_limited") return waitText(result.data.retry_after);
  if (code === "delivery_failed") return "We couldn't send the email right now. Try again in a moment.";
  if (code === "auth_unavailable") return "Accounts aren't open on this deployment yet.";
  if (["forbidden_origin", "unsupported_media_type", "payload_too_large", "invalid_request"].includes(code)) {
    return "This request was blocked. Reload the page and try again.";
  }
  return "KAZER couldn't complete this right now. Try again.";
}

// ---------- API ----------

async function api(path, body, { timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const init = {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: controller.signal,
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, init);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok && !data.error) data.error = "server";
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  } finally {
    window.clearTimeout(timer);
  }
}

// ---------- Estado e modos ----------

const state = {
  mode: "signin",
  busy: false,
  resetToken: null,
  // O servidor informa se há armazenamento persistente; sem ele, nada de login simulado.
  available: true,
};

function setHidden(element, hidden) {
  element.hidden = hidden;
}

function clearFeedback() {
  for (const name of Object.keys(fields)) {
    $(`${name}-error`).textContent = "";
    ui[name].removeAttribute("aria-invalid");
  }
  setHidden(ui.alert, true);
  ui.alertText.textContent = "";
  setHidden(ui.alertAction, true);
  ui.alertAction.onclick = null;
}

function fieldError(name, message) {
  $(`${name}-error`).textContent = message;
  ui[name].setAttribute("aria-invalid", "true");
}

function showAlert(message, action) {
  ui.alertText.textContent = message;
  setHidden(ui.alert, false);
  if (action) {
    ui.alertAction.textContent = action.label;
    ui.alertAction.onclick = action.run;
    setHidden(ui.alertAction, false);
  }
}

function linkContent(lead, strong) {
  ui.switchLink.replaceChildren();
  if (lead) ui.switchLink.append(`${lead} `);
  const emphasis = document.createElement("strong");
  emphasis.textContent = strong;
  ui.switchLink.append(emphasis);
}

function setMode(mode, { focus = false } = {}) {
  const config = MODES[mode];
  const previous = state.mode;
  state.mode = mode;
  clearFeedback();

  const tabbed = mode === "signin" || mode === "signup";
  setHidden(ui.modes, !tabbed);
  setHidden(ui.heading, tabbed);
  ui.modes.dataset.active = mode;
  ui.tabs.forEach((tab) => {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (tabbed) {
    ui.form.setAttribute("aria-labelledby", mode === "signin" ? "tab-signin" : "tab-signup");
  } else {
    ui.headingTitle.textContent = config.title;
    ui.headingLede.textContent = config.lede;
    ui.form.setAttribute("aria-labelledby", "heading-title");
  }

  for (const [name, wrapper] of Object.entries(fields)) {
    const visible = config.fields.includes(name);
    const appearing = visible && wrapper.hidden;
    setHidden(wrapper, !visible);
    ui[name].required = visible;
    ui[name].disabled = !visible;
    if (!visible && name !== "email") ui[name].value = "";
    wrapper.classList.remove("is-entering");
    if (appearing && previous !== mode && !reducedMotion) {
      void wrapper.offsetWidth;
      wrapper.classList.add("is-entering");
    }
  }
  if (config.autocomplete) ui.password.autocomplete = config.autocomplete;
  setHidden(ui.hint, !(mode === "signup" || mode === "reset"));
  ui.password.setAttribute(
    "aria-describedby",
    mode === "signup" || mode === "reset" ? "password-hint password-error" : "password-error",
  );
  ui.submitLabel.textContent = config.submit;
  setHidden(ui.forgot, mode !== "signin");
  setHidden(ui.note, mode !== "signup");
  if (mode === "signin") linkContent("No account?", "Create one");
  else if (mode === "signup") linkContent("Have an account?", "Sign in");
  else linkContent("", "Back to sign in");
  ui.switchLink.parentElement.classList.toggle("is-single", mode !== "signin");

  showForm();
  if (focus) {
    const first = config.fields.map((name) => ui[name]).find((input) => !input.value) || ui[config.fields[0]];
    if (tabbed) ui.tabs.find((tab) => tab.dataset.mode === mode).focus();
    else ui.headingTitle.focus();
    if (!tabbed && finePointer) first.focus();
  }
}

function showForm() {
  setHidden(ui.notice, true);
  setHidden(ui.formView, false);
}

function setBusy(busy) {
  state.busy = busy;
  ui.submit.disabled = busy || !state.available;
  ui.submit.setAttribute("aria-busy", String(busy));
  for (const name of Object.keys(fields)) ui[name].readOnly = busy;
  ui.tabs.forEach((tab) => {
    tab.disabled = busy;
  });
}

function setUnavailable() {
  state.available = false;
  setHidden(ui.availability, false);
  ui.submit.disabled = true;
  ui.submit.setAttribute("aria-describedby", "availability");
}

// ---------- Avisos ----------

function emailNode(email) {
  const span = document.createElement("span");
  span.className = "notice__email";
  span.textContent = email;
  return span;
}

function showNotice({ title, body = [], actions = [], status = "" }) {
  ui.noticeTitle.textContent = title;
  ui.noticeBody.replaceChildren(...body);
  ui.noticeStatus.textContent = status;
  ui.noticeActions.replaceChildren(
    ...actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary ? "primary" : "link";
      if (action.primary) {
        const label = document.createElement("span");
        label.className = "primary__label";
        label.textContent = action.label;
        const progress = document.createElement("span");
        progress.className = "primary__progress";
        progress.setAttribute("aria-hidden", "true");
        button.append(label, progress);
      } else {
        button.textContent = action.label;
      }
      button.addEventListener("click", () => action.run(button));
      return button;
    }),
  );
  setHidden(ui.formView, true);
  setHidden(ui.notice, false);
  if (!root.classList.contains("is-intro")) ui.noticeTitle.focus({ preventScroll: true });
}

function backToSignIn(status = "") {
  setMode("signin", { focus: true });
  if (status) showAlert(status);
}

async function resend(email, button, report) {
  button.disabled = true;
  const result = await api("/api/auth/verify-email/resend", { email });
  button.disabled = false;
  report(
    result.ok
      ? "If this account still needs confirmation, a new link is on its way."
      : generalError(result),
  );
}

// ---------- Sessão autenticada ----------

// Ponto de integração: quando a interface principal do KAZER existir, a
// navegação pós-login acontece aqui (por exemplo, `location.assign("/app")`).
function enterApp(session) {
  showNotice({
    title: "Session active",
    body: ["Signed in as ", emailNode(session.email), "."],
    actions: [
      {
        label: "Sign out",
        primary: true,
        run: async (button) => {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          const result = await api("/api/auth/logout", {});
          button.disabled = false;
          button.removeAttribute("aria-busy");
          if (!result.ok) {
            ui.noticeStatus.textContent = generalError(result);
            return;
          }
          ui.password.value = "";
          backToSignIn();
        },
      },
    ],
  });
}

// ---------- Validação local (o servidor valida de novo) ----------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

function validateLocally() {
  const mode = state.mode;
  const errors = [];
  const email = ui.email.value.trim();
  if (MODES[mode].fields.includes("email")) {
    if (!email) errors.push(["email", "Enter your email address."]);
    else if (!EMAIL_SHAPE.test(email)) errors.push(["email", "Enter a valid email address."]);
  }
  if (MODES[mode].fields.includes("password")) {
    const password = ui.password.value;
    if (!password) errors.push(["password", "Enter your password."]);
    else if (mode !== "signin" && password.length < 10) errors.push(["password", "Use at least 10 characters."]);
    else if (password.length > 128) errors.push(["password", "Use 128 characters or fewer."]);
  }
  if (MODES[mode].fields.includes("confirm")) {
    if (!ui.confirm.value) errors.push(["confirm", "Repeat your password."]);
    else if (ui.confirm.value !== ui.password.value) errors.push(["confirm", "Passwords don't match."]);
  }
  return errors;
}

function applyServerError(result) {
  if (result.data.error === "auth_unavailable") setUnavailable();
  const mapped = FIELD_ERRORS[result.data.error];
  if (mapped && MODES[state.mode].fields.includes(mapped[0])) {
    fieldError(mapped[0], mapped[1]);
    ui[mapped[0]].focus();
    return;
  }
  showAlert(generalError(result));
}

// ---------- Envio ----------

async function submitSignIn(email) {
  const result = await api("/api/auth/login", { email, password: ui.password.value });
  if (result.ok) {
    ui.password.value = "";
    enterApp(result.data);
    return;
  }
  if (result.data.error === "invalid_credentials") {
    ui.password.value = "";
    showAlert("Incorrect email or password.");
    ui.password.focus();
  } else if (result.data.error === "email_not_verified") {
    showAlert("Confirm your email before signing in.", {
      label: "Resend confirmation link",
      run: () => resend(email, ui.alertAction, (message) => {
        ui.alertText.textContent = message;
      }),
    });
  } else {
    applyServerError(result);
  }
}

async function submitSignUp(email) {
  const result = await api("/api/auth/register", { email, password: ui.password.value });
  if (!result.ok) {
    applyServerError(result);
    return;
  }
  ui.password.value = "";
  ui.confirm.value = "";
  showNotice({
    title: "Check your inbox",
    body: [
      "We sent a message to ",
      emailNode(email),
      ". Follow the link inside to activate your account. It expires in 24 hours.",
    ],
    actions: [
      {
        label: "Resend link",
        run: (button) => resend(email, button, (message) => {
          ui.noticeStatus.textContent = message;
        }),
      },
      { label: "Back to sign in", run: () => backToSignIn() },
    ],
  });
}

async function submitRecover(email) {
  const result = await api("/api/auth/password-reset", { email });
  if (!result.ok) {
    applyServerError(result);
    return;
  }
  showNotice({
    title: "Check your inbox",
    body: [
      "If an account exists for ",
      emailNode(email),
      ", a reset link will arrive shortly. It expires in 30 minutes.",
    ],
    actions: [{ label: "Back to sign in", run: () => backToSignIn() }],
  });
}

async function submitReset() {
  const result = await api("/api/auth/password-reset/confirm", {
    token: state.resetToken,
    password: ui.password.value,
  });
  if (result.ok) {
    state.resetToken = null;
    ui.password.value = "";
    ui.confirm.value = "";
    showNotice({
      title: "Password updated",
      body: ["You've been signed out on every device. Sign in with your new password."],
      actions: [{ label: "Sign in", primary: true, run: () => backToSignIn() }],
    });
    return;
  }
  if (result.data.error === "invalid_token") {
    state.resetToken = null;
    showNotice({
      title: "Link expired",
      body: ["This reset link is invalid or has already been used. Request a new one."],
      actions: [
        { label: "Request a new link", primary: true, run: () => setMode("recover", { focus: true }) },
        { label: "Back to sign in", run: () => backToSignIn() },
      ],
    });
    return;
  }
  applyServerError(result);
}

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  clearFeedback();
  const errors = validateLocally();
  if (errors.length) {
    errors.forEach(([name, message]) => fieldError(name, message));
    ui[errors[0][0]].focus();
    return;
  }
  const email = ui.email.value.trim();
  setBusy(true);
  try {
    if (state.mode === "signin") await submitSignIn(email);
    else if (state.mode === "signup") await submitSignUp(email);
    else if (state.mode === "recover") await submitRecover(email);
    else await submitReset();
  } finally {
    setBusy(false);
  }
});

// Erros somem assim que o campo é corrigido.
for (const name of Object.keys(fields)) {
  ui[name].addEventListener("input", () => {
    if (ui[name].getAttribute("aria-invalid")) {
      ui[name].removeAttribute("aria-invalid");
      $(`${name}-error`).textContent = "";
    }
  });
}

// ---------- Alternância (padrão WAI-ARIA de abas) ----------

ui.tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {
    if (state.mode !== tab.dataset.mode) setMode(tab.dataset.mode);
  });
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
    setMode(ui.tabs[next].dataset.mode, { focus: true });
  });
});

ui.forgot.addEventListener("click", () => setMode("recover", { focus: true }));
ui.switchLink.addEventListener("click", () => {
  if (state.mode === "signin") setMode("signup", { focus: true });
  else setMode("signin", { focus: true });
});

// ---------- Teclado virtual ----------

let scene = null;

function watchKeyboard() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let tallest = viewport.height;
  let width = viewport.width;
  const typing = () => {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && !active.readOnly;
  };
  const update = () => {
    if (Math.abs(viewport.width - width) > 40) {
      width = viewport.width;
      tallest = viewport.height;
    }
    tallest = Math.max(tallest, viewport.height);
    const open = typing() && viewport.height < tallest * 0.8;
    if (open === root.classList.contains("kb-open")) return;
    root.classList.toggle("kb-open", open);
    if (open) {
      scene?.pause("keyboard");
      window.requestAnimationFrame(() => document.activeElement?.scrollIntoView({ block: "center" }));
    } else {
      scene?.resume("keyboard");
    }
  };
  viewport.addEventListener("resize", update);
  document.addEventListener("focusin", () => window.setTimeout(update, 250));
  document.addEventListener("focusout", () => window.setTimeout(update, 250));
}

// ---------- Links recebidos por e-mail ----------

// Tokens chegam no fragmento (#), que o navegador nunca envia ao servidor.
// Saem da barra de endereço e do histórico imediatamente.
function takeLinkAction() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  const [key, value = ""] = hash.split("=", 2);
  if (key === "recover") return { type: "recover" };
  if ((key === "verify" || key === "reset") && /^[\w-]{20,128}$/.test(value)) {
    return { type: key, token: value };
  }
  return null;
}

function handleLinkAction(action) {
  if (!action) return;
  if (action.type === "recover") {
    setMode("recover");
  } else if (action.type === "reset") {
    state.resetToken = action.token;
    setMode("reset");
  } else if (action.type === "verify") {
    showNotice({ title: "Confirming your email", status: "Checking the link…" });
    api("/api/auth/verify-email", { token: action.token }).then((result) => {
      if (result.ok) {
        showNotice({
          title: "Email confirmed",
          body: ["Your account is active. Sign in to continue."],
          actions: [{ label: "Sign in", primary: true, run: () => backToSignIn() }],
        });
      } else if (result.data.error === "invalid_token") {
        showNotice({
          title: "Link expired",
          body: ["This confirmation link is invalid or has already been used. Sign in to get a new one."],
          actions: [{ label: "Sign in", primary: true, run: () => backToSignIn() }],
        });
      } else {
        showNotice({
          title: "Couldn't confirm",
          body: [generalError(result)],
          actions: [{ label: "Back to sign in", run: () => backToSignIn() }],
        });
      }
    });
  }
}

// ---------- Abertura ----------

function revealInterface() {
  root.classList.remove("is-booting", "is-intro");
  root.classList.add("is-revealed");
  if (!scene) {
    scene = startScene(ui.scene, { reducedMotion });
    if (root.classList.contains("kb-open")) scene.pause("keyboard");
  }
  if (!ui.notice.hidden) ui.noticeTitle.focus({ preventScroll: true });
  else if (finePointer && state.mode !== "reset") ui.email.focus({ preventScroll: true });
  else if (finePointer) ui.password.focus({ preventScroll: true });
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => window.setTimeout(() => resolve(fallback), ms))]);
}

async function boot() {
  const linkAction = takeLinkAction();
  setMode("signin");
  watchKeyboard();
  // Link colado numa aba já aberta muda só o fragmento, sem recarregar.
  window.addEventListener("hashchange", () => handleLinkAction(takeLinkAction()));

  const [session] = await Promise.all([
    withTimeout(api("/api/auth/session", undefined, { timeout: 2000 }), 900, null),
    withTimeout(document.fonts.load(`500 64px ${DISPLAY_FONT}`).catch(() => null), 700, null),
  ]);

  // Sessão válida: sem replay da abertura completa (links de e-mail têm prioridade).
  if (session?.ok && session.data.authenticated && !linkAction) {
    ui.intro.remove();
    enterApp(session.data);
    revealInterface();
    return;
  }

  if (session?.ok && session.data.available === false) setUnavailable();
  handleLinkAction(linkAction);
  if (reducedMotion || !ui.intro.getContext) {
    ui.intro.remove();
    revealInterface();
    return;
  }
  root.classList.replace("is-booting", "is-intro");
  playIntro(ui.intro, {
    text: "KAZER",
    fontFamily: DISPLAY_FONT,
    onReveal: revealInterface,
    onDone: () => ui.intro.remove(),
  });
}

boot();
