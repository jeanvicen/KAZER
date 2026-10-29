// Tela de entrada do KAZER: abertura em partículas, início com a cena e as duas
// entradas, e a vista de conta (entrar, criar, recuperar, redefinir). Toda
// decisão de autenticação acontece no servidor; o navegador nunca guarda senha
// nem token (o cookie de sessão é HttpOnly).

import { playIntro } from "./intro.js";
import { startScene } from "./scene.js";

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const DISPLAY_FONT = '"Grenze Gotisch", Georgia, serif';

const $ = (id) => document.getElementById(id);
const ui = {
  intro: $("intro"),
  home: $("home"),
  auth: $("auth"),
  openSignup: $("open-signup"),
  openSignin: $("open-signin"),
  back: $("back"),
  taglineText: $("tagline-text"),
  formView: $("form-view"),
  title: $("auth-title"),
  lede: $("auth-lede"),
  form: $("auth-form"),
  email: $("email"),
  password: $("password"),
  confirm: $("confirm"),
  hint: $("password-hint"),
  alert: $("form-alert"),
  alertText: $("form-alert-text"),
  alertAction: $("form-alert-action"),
  availability: $("availability"),
  submit: $("submit"),
  submitLabel: $("submit-label"),
  forgot: $("forgot"),
  switchLink: $("switch"),
  note: $("privacy-note"),
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
    title: "Entrar no KAZER",
    lede: "Use o e-mail e a senha da sua conta.",
    submit: "Entrar",
  },
  signup: {
    fields: ["email", "password", "confirm"],
    autocomplete: "new-password",
    title: "Criar sua conta",
    lede: "Só e-mail e senha. Sem login social, sem rastreadores.",
    submit: "Criar conta",
  },
  recover: {
    fields: ["email"],
    title: "Recuperar acesso",
    lede: "Digite o e-mail da conta. Se ela existir, enviaremos um link para criar uma nova senha.",
    submit: "Enviar link",
  },
  reset: {
    fields: ["password", "confirm"],
    autocomplete: "new-password",
    title: "Nova senha",
    lede: "Ao salvar, você sai de todos os dispositivos.",
    submit: "Salvar nova senha",
  },
};

const FIELD_ERRORS = {
  invalid_email: ["email", "Digite um e-mail válido."],
  password_too_short: ["password", "Use pelo menos 10 caracteres."],
  password_too_long: ["password", "Use no máximo 128 caracteres."],
  password_too_common: ["password", "Essa senha é fácil demais de adivinhar. Tente uma frase mais longa."],
};

function waitText(seconds) {
  if (!seconds) return "Muitas tentativas. Aguarde um pouco e tente de novo.";
  return seconds < 90
    ? `Muitas tentativas. Tente de novo em ${seconds} segundos.`
    : `Muitas tentativas. Tente de novo em ${Math.ceil(seconds / 60)} minutos.`;
}

function generalError(result) {
  const code = result.data.error;
  if (code === "network") return "Sem conexão com o KAZER. Verifique sua internet e tente de novo.";
  if (code === "rate_limited") return waitText(result.data.retry_after);
  if (code === "delivery_failed") return "Não conseguimos enviar o e-mail agora. Tente de novo em instantes.";
  if (code === "auth_unavailable") return "As contas ainda não estão abertas neste ambiente.";
  if (["forbidden_origin", "unsupported_media_type", "payload_too_large", "invalid_request"].includes(code)) {
    return "A solicitação foi bloqueada. Recarregue a página e tente de novo.";
  }
  return "O KAZER não conseguiu concluir agora. Tente de novo.";
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

// ---------- Estado ----------

const state = {
  view: "home",
  mode: "signin",
  busy: false,
  resetToken: null,
  session: null,
  // O servidor informa se há armazenamento persistente; sem ele, nada de login simulado.
  available: true,
};

let scene = null;

function setHidden(element, hidden) {
  element.hidden = hidden;
}

// ---------- Vistas (início ↔ conta) ----------

function animateView(element, back) {
  if (reducedMotion) return;
  const name = back ? "is-entering-back" : "is-entering";
  element.classList.remove("is-entering", "is-entering-back");
  void element.offsetWidth;
  element.classList.add(name);
  element.addEventListener("animationend", () => element.classList.remove(name), { once: true });
}

function showView(view, { back = false } = {}) {
  if (state.view === view) return;
  state.view = view;
  const auth = view === "auth";
  setHidden(ui.home, auth);
  setHidden(ui.auth, !auth);
  animateView(auth ? ui.auth : ui.home, back);
  window.scrollTo(0, 0);
  if (auth) scene?.pause("auth");
  else scene?.resume("auth");
  tagline.toggle(!auth);
}

// O botão voltar do celular volta ao início em vez de sair do site.
function openAuth(mode, { focus = true } = {}) {
  if (state.session) enterApp(state.session);
  else setMode(mode);
  if (state.view !== "auth") window.history.pushState({ view: "auth" }, "");
  showView("auth");
  if (focus) focusAuth();
}

function goHome() {
  if (window.history.state?.view === "auth") window.history.back();
  else showView("home", { back: true });
}

window.addEventListener("popstate", (event) => {
  if (event.state?.view === "auth") showView("auth");
  else showView("home", { back: true });
});

function focusAuth() {
  if (!ui.notice.hidden) {
    ui.noticeTitle.focus({ preventScroll: true });
    return;
  }
  ui.title.focus({ preventScroll: true });
  if (finePointer) {
    const first = MODES[state.mode].fields.map((name) => ui[name]).find((input) => !input.value);
    (first || ui[MODES[state.mode].fields[0]]).focus({ preventScroll: true });
  }
}

ui.openSignup.addEventListener("click", () => openAuth("signup"));
ui.openSignin.addEventListener("click", () => openAuth("signin"));
ui.back.addEventListener("click", goHome);

// ---------- Frase digitada ----------

const tagline = (() => {
  const words = ["executa", "constrói", "resolve", "cria"];
  const lead = "O KAZER ";
  let word = 0;
  let chars = words[0].length;
  let deleting = false;
  let timer = 0;
  let running = false;

  function step() {
    const target = words[word];
    if (!deleting && chars === target.length) {
      deleting = true;
      timer = window.setTimeout(step, 2400);
      return;
    }
    if (deleting && chars === 0) {
      deleting = false;
      word = (word + 1) % words.length;
    }
    chars += deleting ? -1 : 1;
    ui.taglineText.textContent = lead + words[word].slice(0, chars);
    timer = window.setTimeout(step, deleting ? 45 : 85);
  }

  return {
    toggle(on) {
      if (reducedMotion || on === running) return;
      running = on && !document.hidden;
      window.clearTimeout(timer);
      if (running) timer = window.setTimeout(step, 1200);
    },
  };
})();

document.addEventListener("visibilitychange", () => tagline.toggle(state.view === "home" && !document.hidden));

// ---------- Formulário ----------

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
  ui.title.textContent = config.title;
  ui.lede.textContent = config.lede;

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
  const newPassword = mode === "signup" || mode === "reset";
  setHidden(ui.hint, !newPassword);
  ui.password.setAttribute("aria-describedby", newPassword ? "password-hint password-error" : "password-error");
  ui.submitLabel.textContent = config.submit;
  setHidden(ui.forgot, mode !== "signin");
  setHidden(ui.note, mode !== "signup");
  if (mode === "signin") linkContent("Não tem conta?", "Criar conta");
  else if (mode === "signup") linkContent("Já tem conta?", "Entrar");
  else linkContent("", "Voltar para entrar");
  ui.switchLink.parentElement.classList.toggle("is-single", mode !== "signin");

  setHidden(ui.notice, true);
  setHidden(ui.formView, false);
  if (focus) focusAuth();
}

function setBusy(busy) {
  state.busy = busy;
  ui.submit.disabled = busy || !state.available;
  ui.submit.setAttribute("aria-busy", String(busy));
  for (const name of Object.keys(fields)) ui[name].readOnly = busy;
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
      button.className = action.primary ? "button button--primary" : "link";
      button.textContent = action.label;
      button.addEventListener("click", () => action.run(button));
      return button;
    }),
  );
  setHidden(ui.formView, true);
  setHidden(ui.notice, false);
  if (state.view === "auth" && !root.classList.contains("is-intro")) {
    ui.noticeTitle.focus({ preventScroll: true });
  }
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
      ? "Se a conta ainda precisar de confirmação, um novo link está a caminho."
      : generalError(result),
  );
}

// ---------- Sessão autenticada ----------

// Ponto de integração: quando a interface principal do KAZER existir, a
// navegação pós-login acontece aqui (por exemplo, `location.assign("/app")`).
function enterApp(session) {
  state.session = session;
  showNotice({
    title: "Sessão ativa",
    body: ["Conectado como ", emailNode(session.email), "."],
    actions: [
      {
        label: "Sair",
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
          state.session = null;
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
    if (!email) errors.push(["email", "Digite seu e-mail."]);
    else if (!EMAIL_SHAPE.test(email)) errors.push(["email", "Digite um e-mail válido."]);
  }
  if (MODES[mode].fields.includes("password")) {
    const password = ui.password.value;
    if (!password) errors.push(["password", "Digite sua senha."]);
    else if (mode !== "signin" && password.length < 10) errors.push(["password", "Use pelo menos 10 caracteres."]);
    else if (password.length > 128) errors.push(["password", "Use no máximo 128 caracteres."]);
  }
  if (MODES[mode].fields.includes("confirm")) {
    if (!ui.confirm.value) errors.push(["confirm", "Repita a senha."]);
    else if (ui.confirm.value !== ui.password.value) errors.push(["confirm", "As senhas não coincidem."]);
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
    showAlert("E-mail ou senha incorretos.");
    ui.password.focus();
  } else if (result.data.error === "email_not_verified") {
    showAlert("Confirme seu e-mail antes de entrar.", {
      label: "Reenviar link de confirmação",
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
    title: "Confira seu e-mail",
    body: [
      "Enviamos uma mensagem para ",
      emailNode(email),
      ". Abra o link para ativar sua conta. Ele vale por 24 horas.",
    ],
    actions: [
      {
        label: "Reenviar link",
        run: (button) => resend(email, button, (message) => {
          ui.noticeStatus.textContent = message;
        }),
      },
      { label: "Voltar para entrar", run: () => backToSignIn() },
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
    title: "Confira seu e-mail",
    body: [
      "Se existir uma conta para ",
      emailNode(email),
      ", o link chega em instantes. Ele vale por 30 minutos.",
    ],
    actions: [{ label: "Voltar para entrar", run: () => backToSignIn() }],
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
      title: "Senha atualizada",
      body: ["Você saiu de todos os dispositivos. Entre com a nova senha."],
      actions: [{ label: "Entrar", primary: true, run: () => backToSignIn() }],
    });
    return;
  }
  if (result.data.error === "invalid_token") {
    state.resetToken = null;
    showNotice({
      title: "Link expirado",
      body: ["Este link é inválido ou já foi usado. Peça um novo."],
      actions: [
        { label: "Pedir novo link", primary: true, run: () => setMode("recover", { focus: true }) },
        { label: "Voltar para entrar", run: () => backToSignIn() },
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

ui.forgot.addEventListener("click", () => setMode("recover", { focus: true }));
ui.switchLink.addEventListener("click", () => {
  if (state.mode === "signin") setMode("signup", { focus: true });
  else setMode("signin", { focus: true });
});

// ---------- Teclado virtual ----------

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
      window.requestAnimationFrame(() => document.activeElement?.scrollIntoView({ block: "center" }));
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
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
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
    showNotice({ title: "Confirmando seu e-mail", status: "Verificando o link…" });
    api("/api/auth/verify-email", { token: action.token }).then((result) => {
      if (result.ok) {
        showNotice({
          title: "E-mail confirmado",
          body: ["Sua conta está ativa. Entre para continuar."],
          actions: [{ label: "Entrar", primary: true, run: () => backToSignIn() }],
        });
      } else if (result.data.error === "invalid_token") {
        showNotice({
          title: "Link expirado",
          body: ["Este link de confirmação é inválido ou já foi usado. Entre para receber um novo."],
          actions: [{ label: "Entrar", primary: true, run: () => backToSignIn() }],
        });
      } else {
        showNotice({
          title: "Não foi possível confirmar",
          body: [generalError(result)],
          actions: [{ label: "Voltar para entrar", run: () => backToSignIn() }],
        });
      }
    });
  }
  if (state.view !== "auth") window.history.pushState({ view: "auth" }, "");
  showView("auth");
}

// ---------- Abertura ----------

function revealInterface() {
  root.classList.remove("is-booting", "is-intro");
  root.classList.add("is-revealed");
  if (!scene) {
    scene = startScene(ui.scene, { reducedMotion });
    if (state.view === "auth") scene.pause("auth");
  }
  tagline.toggle(state.view === "home");
  if (state.view === "auth") focusAuth();
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => window.setTimeout(() => resolve(fallback), ms))]);
}

async function boot() {
  const linkAction = takeLinkAction();
  window.history.replaceState({ view: "home" }, "");
  setMode("signin");
  watchKeyboard();
  // Link colado numa aba já aberta muda só o fragmento, sem recarregar.
  window.addEventListener("hashchange", () => handleLinkAction(takeLinkAction()));

  const [session] = await Promise.all([
    withTimeout(api("/api/auth/session", undefined, { timeout: 2000 }), 900, null),
    withTimeout(document.fonts.load(`500 64px ${DISPLAY_FONT}`).catch(() => null), 700, null),
  ]);

  if (session?.ok && session.data.available === false) setUnavailable();

  // Sessão válida: sem replay da abertura completa (links de e-mail têm prioridade).
  if (session?.ok && session.data.authenticated && !linkAction) {
    ui.intro.remove();
    openAuth("signin", { focus: false });
    enterApp(session.data);
    revealInterface();
    return;
  }

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
