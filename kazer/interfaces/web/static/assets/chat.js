// Chat do KAZER. Toda autorização acontece no servidor (cookie HttpOnly);
// aqui só há estado de interface. Respostas chegam em streaming (NDJSON) e,
// se a rede cair no meio, a interface reata do último evento recebido.

import { hydratePixelWords } from "./pixel.js";
import {
  announce,
  byId,
  dayGroup,
  finePointer,
  formatBytes,
  formatReset,
  h,
  hydrateIcons,
  icon,
  mark,
  reducedMotion,
  session as tabStore,
  setMotionPreference,
  store,
  trapFocus,
  uuid,
} from "./dom.js";
import { copyText, MarkdownView, render as renderMarkdown } from "./markdown.js";
import { net, readEvents, request, waitOnline } from "./net.js";
import { closeSheet, confirmDialog, openSheet, promptDialog, setSheetBackground, toast } from "./sheets.js";
import { startAmbient } from "./squares.js";

const desktopQuery = window.matchMedia("(min-width: 60rem)");
const coarse = window.matchMedia("(pointer: coarse)");

// ---------- Textos ----------

const GREETINGS = {
  madrugada: [["Ainda por aqui?", "Vamos nessa."], ["Madrugada criativa?", "Tô aqui com você."], ["Noite longa?", "Bora pensar junto."]],
  manha: [["Bom dia.", "O que vamos criar?"], ["Bom dia.", "Por onde começamos?"], ["Bom dia.", "Qual é o plano de hoje?"]],
  tarde: [["Boa tarde.", "No que vamos trabalhar?"], ["Boa tarde.", "O que vamos resolver?"], ["Boa tarde.", "Bora tirar algo do papel?"]],
  noite: [["Boa noite.", "Vamos pensar em algo novo?"], ["Boa noite.", "O que vamos construir?"], ["Boa noite.", "Ainda dá tempo de criar algo."]],
};

const REPLY_ERRORS = {
  model_timeout: "O modelo demorou demais para responder.",
  model_busy: "O KAZER está com muita demanda agora.",
  model_unreachable: "Não deu para falar com o modelo agora.",
  model_auth: "O KAZER está indisponível no momento.",
  model_rejected: "O modelo não aceitou este pedido.",
  model_refused: "O KAZER não pode ajudar com esse pedido.",
  model_empty: "O modelo não devolveu nenhuma resposta.",
  model_error: "Algo deu errado ao gerar a resposta.",
  interrupted: "A resposta foi interrompida.",
};

const SEND_ERRORS = {
  network: "Sem conexão. Sua mensagem não foi enviada e continua no campo.",
  timeout: "A conexão demorou demais. Sua mensagem continua no campo.",
  model_unavailable: "O KAZ 1.1 ainda não está conectado neste ambiente.",
  rate_limited: "Muitas mensagens seguidas. Espere um instante.",
  capacity: "O KAZER está cheio agora. Tente em alguns segundos.",
  busy: "Espere a resposta atual terminar.",
  not_found: "Esta conversa não existe mais.",
  attachment_invalid: "Um dos anexos não está mais disponível. Remova e anexe de novo.",
  images_unavailable: "O modelo atual não lê imagens.",
  documents_unavailable: "O modelo atual não lê PDFs.",
  deep_unavailable: "Pensamento profundo está indisponível com o modelo atual.",
  web_search_unavailable: "A busca na web está indisponível no momento.",
  research_unavailable: "A pesquisa está indisponível no momento.",
  message_too_long: "Mensagem longa demais: o máximo é de 32 mil caracteres.",
  empty_message: "Escreva algo ou anexe um arquivo.",
  not_retryable: "Essa resposta não pode ser gerada de novo.",
  unauthenticated: "Sua sessão expirou.",
  auth_unavailable: "As contas estão fechadas neste ambiente.",
  chat_unavailable: "O chat ainda não está disponível neste ambiente.",
  plan_required: "O KZ Code entra com os planos pagos.",
  invalid_effort: "Esse esforço não está disponível agora. Voltei para o Baixo; é só enviar de novo.",
};

const UPLOAD_ERRORS = {
  attachment_type: "Tipo de arquivo não suportado.",
  attachment_too_large: "Arquivo grande demais.",
  attachment_empty: "Arquivo vazio.",
  attachment_quota: "Limite de anexos atingido. Envie ou remova alguns antes.",
  images_unavailable: "O modelo atual não lê imagens.",
  documents_unavailable: "O modelo atual não lê PDFs.",
  rate_limited: "Muitos anexos seguidos. Espere um pouco.",
  model_unavailable: "O KAZ 1.1 ainda não está conectado neste ambiente.",
  network: "Sem conexão: o anexo não foi enviado.",
  payload_too_large: "Arquivo grande demais.",
};

async function offerPlans(data) {
  const { limitReached } = await import("./plans.js");
  limitReached(data, { opener: S.ui.prompt });
}

// O plano atual não libera o recurso pedido: a tela explica e oferece.
async function offerFeature(data) {
  const { openPlans } = await import("./plans.js");
  openPlans({ opener: S.ui.prompt, highlight: data.upgrade?.id });
}

function sendError(data) {
  if (data.error === "usage_limit") {
    return data.reset_at
      ? `Você chegou ao limite de uso por agora. Libera ${formatReset(data.reset_at)}.`
      : "Você chegou ao limite de uso por agora.";
  }
  return SEND_ERRORS[data.error] || "Não foi possível enviar agora. Tente de novo.";
}

// ---------- Estado ----------

const S = {
  root: null,
  ui: {},
  account: null,
  prefs: {},
  model: null,
  conversation: null, // { id, title } | null (nova)
  screen: "conversas",
  screens: null,
  forja: false,
  models: new Map(), // id -> mensagem (estado de interface)
  oldestSeq: null,
  hasMore: false,
  loadingOlder: false,
  empty: true,
  ambient: null,
  sending: false,
  live: null, // { replyId, lastIndex, controller }
  attachments: [],
  options: { effort: store.get("kazer:effort", "baixo"), web: false, memory: true },
  pinned: true,
  history: { items: [], next: null, query: "", loaded: false, loading: false },
  lastAttempt: null,
  greetingKey: "",
  navToken: 0,
};

let lazyObserver = null;
let olderObserver = null;
let historyObserver = null;

// ---------- Montagem ----------

export async function mountChat({ email, onSignedOut }) {
  const root = document.getElementById("chat");
  const template = document.getElementById("tpl-chat");
  root.replaceChildren(template.content.cloneNode(true));
  hydrateIcons(root);
  hydratePixelWords(root);
  root.hidden = false;
  document.documentElement.classList.add("in-chat");
  S.root = root;
  S.onSignedOut = onSignedOut;
  const ids = [
    "drawer", "drawer-close", "new-chat", "history-search", "history", "history-list", "history-empty",
    "history-more", "drawer-nav", "panel-conversas", "screen",
    "open-settings", "account-avatar", "account-mail", "sign-out", "drawer-scrim", "pane",
    "menu", "topbar-title", "new-chat-top", "ambient", "empty", "greeting", "greeting-a", "greeting-b",
    "empty-note", "thread", "messages", "older", "to-bottom", "composer", "composer-alert",
    "composer-alert-text", "composer-alert-close", "composer-box", "tray", "prompt", "plus", "model-chip",
    "open-palette",
    "forja-chip", "mic", "send", "pick-camera", "pick-photos", "pick-files",
  ];
  for (const id of ids) S.ui[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = byId(root, id);
  setSheetBackground(root);
  setAccount(email);
  bindViewport();
  bindDrawer();
  bindComposer();
  bindThread();
  bindShortcuts();
  window.addEventListener("popstate", onPopState);
  window.addEventListener("kazer:unauthenticated", onExpired);
  net.subscribe(onNetwork);

  applyLocalPrefs();
  startEmpty({ animate: true });
  const path = conversationFromPath();
  if (path) openConversation(path, { push: false });

  await loadSettings();
  if (desktopQuery.matches && store.get("kazer:drawer", true)) openDrawer({ focus: false });
}

function setAccount(email) {
  S.account = { ...(S.account || {}), email };
  S.ui.accountMail.textContent = email || "";
  S.ui.accountAvatar.textContent = (email || "?").trim().charAt(0).toUpperCase();
}

async function loadSettings() {
  const result = await request("/api/settings");
  S.settingsFailed = !result.ok && result.data.error !== "chat_unavailable";
  if (!result.ok) {
    if (result.data.error !== "unauthenticated") {
      // Sem configuração não dá para saber o que o modelo suporta: tudo fica desligado.
      S.model = { available: false, features: {}, chatUnavailable: result.data.error === "chat_unavailable", notMigrated: result.data.reason === "not_migrated" };
      applyModel();
    }
    return;
  }
  S.prefs = result.data.preferences;
  S.model = result.data.model;
  S.memories = result.data.memories;
  setAccount(result.data.account.email);
  S.account.created_at = result.data.account.created_at;
  S.account.verified_at = result.data.account.verified_at;
  S.options.memory = S.prefs.memory_enabled;
  store.set("kazer:ui", { motion: S.prefs.motion, text_size: S.prefs.text_size, ambient: S.prefs.ambient });
  applyLocalPrefs();
  applyModel();
  if (S.empty) setGreeting(true);
}

// Preferências visuais aplicadas antes da resposta do servidor (sem "pulo").
function applyLocalPrefs() {
  const ui = { motion: "sistema", text_size: "m", ambient: true, ...store.get("kazer:ui", {}), ...pick(S.prefs, ["motion", "text_size", "ambient"]) };
  setMotionPreference(ui.motion);
  document.documentElement.dataset.textSize = ui.text_size;
  S.ambientEnabled = ui.ambient;
  if (S.empty) {
    if (!ui.ambient && S.ambient) {
      S.ambient.destroy();
      S.ambient = null;
    } else if (ui.ambient && !S.ambient) startAmbientField();
  }
}

function pick(object, keys) {
  const out = {};
  for (const key of keys) if (object && key in object) out[key] = object[key];
  return out;
}

function applyModel() {
  const model = S.model || { available: false, features: {} };
  const features = model.features || {};
  const unavailable = !model.available;
  S.ui.modelChip.classList.toggle("is-off", unavailable);
  // Só vale o esforço que o servidor oferece; o resto volta para o Baixo.
  if (!offeredEfforts().some((item) => item.id === S.options.effort)) setEffort("baixo", { quiet: true });
  paintEffort();
  S.ui.emptyNote.hidden = !unavailable;
  S.ui.emptyNote.textContent = model.notMigrated
    ? "O banco do KAZER está no ar, mas ainda não recebeu as migrações do chat. Sua conta está ativa; quem administra o servidor precisa aplicá-las."
    : model.chatUnavailable
    ? "O chat ainda não está disponível neste ambiente: falta configurar o banco das conversas. Sua conta está ativa."
    : unavailable
      ? "O KAZ 1.1 ainda não foi conectado a um modelo neste servidor. Seu histórico continua disponível."
      : "";
  if (model.accept) S.ui.pickFiles.accept = model.accept.join(",");
  updateSendState();
}

// Chamado pelas configurações quando algo muda.
export function onPreferencesChanged(prefs) {
  S.prefs = { ...S.prefs, ...prefs };
  S.options.memory = S.prefs.memory_enabled;
  store.set("kazer:ui", { motion: S.prefs.motion, text_size: S.prefs.text_size, ambient: S.prefs.ambient });
  applyLocalPrefs();
  if (S.empty) setGreeting(false);
}

// ---------- Viewport (teclado virtual e áreas seguras) ----------

function bindViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  // Altura real do composer: posiciona "ir para o fim" e os avisos logo acima dele.
  new ResizeObserver(([entry]) => {
    root.style.setProperty("--composer-h", `${Math.round(entry.target.offsetHeight)}px`);
  }).observe(S.ui.composer);
  if (!viewport) return;
  const sync = () => {
    root.style.setProperty("--app-h", `${Math.round(viewport.height)}px`);
    root.style.setProperty("--app-top", `${Math.round(viewport.offsetTop)}px`);
    if (S.pinned) scrollToBottom(false);
  };
  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
  sync();
}

// ---------- Saudação e estado vazio ----------

function period(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

function setGreeting(force) {
  const now = new Date();
  const part = period(now);
  const key = `${now.toDateString()}|${part}|${S.prefs.nickname || ""}`;
  if (!force && key === S.greetingKey) return;
  S.greetingKey = key;
  const seed = [...`${now.toDateString()}${part}`].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const options = GREETINGS[part];
  let [first, second] = options[seed % options.length];
  const name = (S.prefs.nickname || "").trim();
  if (name) first = first.replace(/([.?!])$/, `, ${name}$1`);
  S.ui.greetingA.textContent = first;
  S.ui.greetingB.textContent = second;
}

// A saudação só muda com o período do dia e nunca enquanto a pessoa escreve.
window.setInterval(() => {
  if (!S.root || !S.empty || document.hidden) return;
  if (S.ui.prompt.value || document.activeElement === S.ui.prompt) return;
  setGreeting(false);
}, 60000);

function startAmbientField() {
  if (!S.ambientEnabled || S.ambient) return;
  const canvas = S.ui.ambient;
  canvas.classList.remove("is-leaving");
  canvas.hidden = false;
  S.ambient = startAmbient(canvas, { reducedMotion: reducedMotion() });
}

function startEmpty({ animate = false } = {}) {
  S.empty = true;
  S.ui.empty.hidden = false;
  S.ui.empty.classList.remove("is-leaving");
  S.ui.thread.hidden = true;
  S.ui.pane.classList.add("is-empty");
  S.ui.toBottom.hidden = true;
  setGreeting(true);
  startAmbientField();
  if (animate && !reducedMotion()) {
    const markEl = S.ui.empty.querySelector(".empty__mark");
    markEl.classList.add("is-generating");
    window.setTimeout(() => markEl.classList.remove("is-generating"), 1700);
    S.ui.empty.classList.remove("is-entering");
    void S.ui.empty.offsetWidth;
    S.ui.empty.classList.add("is-entering");
  }
}

// Primeira mensagem aceita: o campo de quadrados sai de cena e é liberado.
function leaveEmpty() {
  if (!S.empty) return;
  S.empty = false;
  S.ui.pane.classList.remove("is-empty");
  S.ui.thread.hidden = false;
  if (S.ambient) {
    const ambient = S.ambient;
    S.ambient = null;
    ambient.leave().then(() => {
      if (!S.empty) S.ui.ambient.hidden = true;
    });
  }
  if (reducedMotion()) S.ui.empty.hidden = true;
  else {
    S.ui.empty.classList.add("is-leaving");
    window.setTimeout(() => {
      if (!S.empty) S.ui.empty.hidden = true;
    }, 420);
  }
}

// ---------- Navegação ----------

function conversationFromPath() {
  const match = window.location.pathname.match(/^\/c\/([A-Za-z0-9_-]{16,64})$/);
  return match ? match[1] : null;
}

function onPopState() {
  const id = conversationFromPath();
  if (id && id !== S.conversation?.id) openConversation(id, { push: false });
  else if (!id && S.conversation) newConversation({ push: false });
}

function resetThread() {
  S.models.clear();
  S.oldestSeq = null;
  S.hasMore = false;
  lazyObserver?.disconnect();
  for (const node of [...S.ui.messages.children]) if (node !== S.ui.older) node.remove();
}

function detachLive() {
  if (S.live) {
    S.live.controller.abort();
    S.live = null;
  }
  setStreamingUi(false);
}

function newConversation({ push = true, focus = true } = {}) {
  if (S.screen !== "conversas") showScreen("conversas");
  setForja(false);
  S.navToken += 1;
  detachLive();
  S.conversation = null;
  resetThread();
  setTitle("");
  startEmpty({ animate: true });
  restoreDraft();
  markActiveHistory();
  if (push && window.location.pathname !== "/") window.history.pushState({ chat: "new" }, "", "/");
  if (!desktopQuery.matches) closeDrawer({ focus: false });
  if (focus && finePointer()) S.ui.prompt.focus();
}

// ---------- Abas da gaveta ----------

const SCREENS = ["conversas", "forja", "artefatos", "biblioteca"];

const SCREEN_LABELS = {
  conversas: "Conversas",
  forja: "KZ Code",
  artefatos: "Artefatos",
  biblioteca: "Biblioteca",
};

const SCREEN_GLYPHS = {
  conversas: "chat",
  forja: "code",
  artefatos: "layers",
  biblioteca: "book",
};

async function showScreen(name) {
  if (!SCREENS.includes(name) || S.screen === name) {
    if (!desktopQuery.matches) closeDrawer();
    return;
  }
  S.screen = name;
  for (const item of S.ui.drawerNav.children) {
    item.classList.toggle("is-active", item.dataset.screen === name);
  }
  if (!desktopQuery.matches) closeDrawer();

  if (name === "conversas") {
    S.screens?.close();
    S.ui.pane.hidden = false;
    return;
  }
  if (!S.screens) {
    const { createScreens } = await import("./screens.js");
    S.screens = createScreens({
      host: S.ui.screen,
      onMenu: () => openDrawer(),
      onOpenConversation: (id, options = {}) => {
        showScreen("conversas");
        openConversation(id);
        // Sessão aberta pelo KZ Code continua no modo KZ Code.
        if (options.code) setForja(true);
      },
      onOpenSettings: (section) => openSettings(section),
      onStartForja: (prompt) => {
        showScreen("conversas");
        startForja(prompt);
      },
      onOpenPlans: async (opener, highlight) => {
        const { openPlans } = await import("./plans.js");
        openPlans({ opener, highlight });
      },
    });
  }
  // A conversa some de vista, mas continua viva: voltar não recarrega nada.
  S.ui.pane.hidden = true;
  await S.screens.open(name);
}

// Abre uma conversa nova já no modo KZ Code; com um pedido, já envia.
function startForja(prompt = "") {
  newConversation({ push: true, focus: true });
  setForja(true);
  if (!desktopQuery.matches) closeDrawer();
  if (prompt) {
    S.ui.prompt.value = prompt;
    autosize();
    updateSendState();
    send();
  }
}

function setForja(on) {
  S.forja = on;
  S.ui.composerBox.classList.toggle("is-forja", on);
  S.ui.forjaChip.hidden = !on;
  S.ui.forjaChip.classList.toggle("is-on", on);
  S.ui.forjaChip.setAttribute("aria-pressed", String(on));
  if (S.ui.prompt) {
    S.ui.prompt.placeholder = on ? "O que vamos construir?" : "Converse com o KAZER...";
  }
}

async function openConversation(id, { push = true } = {}) {
  if (S.screen !== "conversas") showScreen("conversas");
  // Conversa aberta no KZ Code volta no KZ Code (a lista vem do servidor).
  setForja(Boolean(S.prefs?.code_sessions?.includes(id)));
  const token = (S.navToken += 1);
  detachLive();
  if (push) window.history.pushState({ chat: id }, "", `/c/${id}`);
  if (!desktopQuery.matches) closeDrawer({ focus: false });
  S.conversation = { id, title: S.history.items.find((item) => item.id === id)?.title || "" };
  setTitle(S.conversation.title);
  markActiveHistory();
  resetThread();
  leaveEmpty();
  S.ui.thread.classList.add("is-loading");
  const result = await request(`/api/conversations/${id}`);
  if (token !== S.navToken) return;
  S.ui.thread.classList.remove("is-loading");
  if (!result.ok) {
    if (result.data.error === "not_found") toast("Conversa não encontrada.");
    else if (result.data.error !== "unauthenticated") toast("Não deu para abrir a conversa agora.", { action: { label: "Tentar de novo", run: () => openConversation(id, { push: false }) } });
    newConversation({ push: false });
    window.history.replaceState({ chat: "new" }, "", "/");
    return;
  }
  S.conversation = result.data.conversation;
  setTitle(S.conversation.title);
  restoreDraft();
  const page = result.data.messages;
  renderPage(page.items, page.has_more, { initial: true });
  // Resposta ainda em geração (por exemplo, aba recarregada no meio): reata.
  const streaming = page.items.filter((m) => m.role === "assistant" && m.status === "streaming").pop();
  if (streaming) resume(streaming.id, -1);
}

// O KAZER nomeia a conversa quando a primeira resposta fica pronta.
function applyTitle(conversationId, title) {
  if (!title) return;
  if (S.conversation?.id === conversationId) {
    S.conversation.title = title;
    setTitle(title);
  }
  const item = S.history.items.find((entry) => entry.id === conversationId);
  if (item && item.title !== title) {
    item.title = title;
    if (S.history.loaded) renderHistory();
  }
}

function setTitle(title) {
  S.ui.topbarTitle.textContent = title || "";
  document.title = title ? `${title} · KAZER` : "KAZER";
}

// ---------- Conversa: renderização progressiva ----------

function bindThread() {
  const thread = S.ui.thread;
  thread.addEventListener(
    "scroll",
    () => {
      const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
      S.pinned = distance < 96;
      S.ui.toBottom.hidden = S.pinned || S.empty;
    },
    { passive: true },
  );
  S.ui.toBottom.addEventListener("click", () => scrollToBottom(true));
  // Markdown só é montado quando a mensagem chega perto da tela.
  lazyObserver = createLazyObserver();
  olderObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadOlder();
    },
    { root: thread, rootMargin: "700px 0px 0px 0px" },
  );
  olderObserver.observe(S.ui.older);
}

function createLazyObserver() {
  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        lazyObserver.unobserve(entry.target);
        const model = S.models.get(entry.target.dataset.id);
        if (model) paintBody(model);
      }
    },
    { root: S.ui.thread, rootMargin: "1200px 0px" },
  );
}

function scrollToBottom(smooth) {
  const thread = S.ui.thread;
  if (thread.hidden) return;
  thread.scrollTo({ top: thread.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  S.pinned = true;
  S.ui.toBottom.hidden = true;
}

function renderPage(items, hasMore, { initial = false, prepend = false } = {}) {
  S.hasMore = hasMore;
  if (items.length) S.oldestSeq = items[0].seq;
  const fragment = document.createDocumentFragment();
  const created = [];
  for (const item of items) {
    if (S.models.has(item.id)) continue;
    const model = createModel(item);
    fragment.append(model.el);
    created.push(model);
  }
  const thread = S.ui.thread;
  if (prepend) {
    const fromBottom = thread.scrollHeight - thread.scrollTop;
    S.ui.older.after(fragment);
    thread.scrollTop = thread.scrollHeight - fromBottom;
  } else {
    S.ui.messages.append(fragment);
  }
  if (lazyObserver === null) lazyObserver = createLazyObserver();
  // As últimas já nascem prontas; as antigas esperam a vez de aparecer.
  created.forEach((model, index) => {
    if (initial && index >= created.length - 4) paintBody(model);
    else lazyObserver.observe(model.el);
  });
  if (initial) window.requestAnimationFrame(() => scrollToBottom(false));
  S.ui.older.classList.toggle("is-active", hasMore);
  if (!prepend) refreshRetry();
}

// Só a última resposta oferece "tentar de novo".
function refreshRetry() {
  for (const model of S.models.values()) {
    if (model.role === "assistant" && (model.status === "error" || model.status === "stopped" || model.retryShown)) {
      applyStatus(model);
    }
  }
}

async function loadOlder() {
  if (!S.hasMore || S.loadingOlder || !S.conversation || S.oldestSeq === null) return;
  S.loadingOlder = true;
  const token = S.navToken;
  S.ui.older.classList.add("is-loading");
  const result = await request(`/api/conversations/${S.conversation.id}/messages?before=${S.oldestSeq}`);
  S.ui.older.classList.remove("is-loading");
  S.loadingOlder = false;
  if (token !== S.navToken || !result.ok) return;
  renderPage(result.data.items, result.data.has_more, { prepend: true });
}

function createModel(item) {
  const model = { ...item, painted: false, view: null, el: null, startedAt: null };
  model.el = item.role === "user" ? userElement(model) : assistantElement(model);
  S.models.set(model.id, model);
  return model;
}

function attachmentList(attachments) {
  return h(
    "ul.files",
    { "aria-label": "Anexos" },
    attachments.map((file) => {
      if (file.kind === "image") {
        const src = file.preview || (file.id ? `/api/attachments/${file.id}` : "");
        return h(
          "li.files__item.files__item--image",
          {},
          h("a.files__link", { href: src, target: "_blank", rel: "noopener", "aria-label": `Abrir ${file.name}` }, h("img.files__img", { src, alt: file.name, loading: "lazy", decoding: "async" })),
        );
      }
      return h(
        "li.files__item",
        {},
        h(
          "a.files__link.files__doc",
          { href: file.id ? `/api/attachments/${file.id}` : "#", download: file.name },
          icon("file"),
          h("span.files__meta", {}, h("span.files__name", { text: file.name }), h("span.files__size", { text: formatBytes(file.size) })),
        ),
      );
    }),
  );
}

function userElement(model) {
  return h(
    "article.msg.msg--user",
    { dataset: { id: model.id } },
    model.attachments?.length ? attachmentList(model.attachments) : null,
    model.content ? h("div.msg__bubble", { text: model.content }) : null,
    h("div.msg__actions", {}, actionButton("copy", "Copiar mensagem", () => model.content)),
  );
}

function actionButton(name, label, getText) {
  const button = h("button.msg__action", { type: "button", "aria-label": label, title: label }, icon(name));
  button.addEventListener("click", async () => {
    const ok = await copyText(getText());
    button.replaceChildren(icon(ok ? "check" : "close"));
    button.classList.toggle("is-done", ok);
    announce(ok ? "Copiado." : "Não foi possível copiar.");
    window.setTimeout(() => {
      button.replaceChildren(icon(name));
      button.classList.remove("is-done");
    }, 1500);
  });
  return button;
}

function assistantElement(model) {
  const head = h("div.msg__head", {}, mark("msg__mark"), h("span.msg__state"));
  const thinking = h(
    "details.think",
    { hidden: true },
    h("summary.think__summary", {}, h("span.think__label", { text: "Raciocínio" }), icon("chevron", "think__caret")),
    h("div.think__body.md"),
  );
  const body = h("div.msg__body.md");
  const notice = h("div.msg__notice", { hidden: true });
  const actions = h("div.msg__actions", {}, actionButton("copy", "Copiar resposta", () => model.content));
  const made = h("div.msg__made", { hidden: true });
  const steps = h("ol.msg__steps", { hidden: true, "aria-label": "O que o KAZER está fazendo" });
  const el = h("article.msg.msg--kazer", { dataset: { id: model.id } }, head, steps, thinking, body, made, notice, actions);
  model.el = el;
  model.parts = { head, steps, thinking, body, made, notice, actions, state: head.lastChild, thinkBody: thinking.lastChild };
  model.view = new MarkdownView(body);
  applyStatus(model);
  return el;
}

function paintBody(model) {
  if (model.role !== "assistant") return;
  model.painted = true;
  model.view.update(model.content || "");
  paintSteps(model);
  paintArtifacts(model);
  if (model.thinking) {
    model.parts.thinking.hidden = false;
    model.parts.thinkBody.replaceChildren(renderMarkdown(model.thinking));
  }
}

function paintSteps(model) {
  const list = model.parts?.steps;
  if (!list) return;
  const steps = model.steps || [];
  if (!steps.length) {
    list.hidden = true;
    list.replaceChildren();
    return;
  }
  list.hidden = false;
  list.replaceChildren(
    ...steps.map((label, index) =>
      h(
        `li.msg__step${index === steps.length - 1 && model.status === "streaming" ? ".is-now" : ""}`,
        {},
        h("span.msg__step-dot", { "aria-hidden": "true" }),
        h("span", { text: label }),
      ),
    ),
  );
}

function paintArtifacts(model) {
  const strip = model.parts?.made;
  const items = model.artifacts;
  if (!strip) return;
  if (!items?.length) {
    strip.hidden = true;
    strip.replaceChildren();
    return;
  }
  strip.hidden = false;
  strip.replaceChildren(
    h("span.msg__made-label", { text: items.length === 1 ? "Na sua Biblioteca:" : `${items.length} peças na sua Biblioteca:` }),
    ...items.map((item) =>
      h(
        "button.made-chip",
        {
          type: "button",
          onclick: async () => {
            const { openArtifactById } = await import("./library.js");
            openArtifactById(item.id);
          },
        },
        icon("book"),
        h("span", { text: item.title }),
      ),
    ),
  );
}

function applyStatus(model) {
  if (model.role !== "assistant") return;
  const { head, notice, state } = model.parts;
  const el = model.el;
  const streaming = model.status === "streaming";
  el.classList.toggle("is-streaming", streaming);
  el.classList.toggle("is-error", model.status === "error");
  head.classList.toggle("is-generating", streaming);
  if (streaming) {
    state.textContent = model.searching ? "Buscando na web…" : model.content ? "" : model.thinking ? "Pensando…" : model.reconnecting ? "Reconectando…" : "Pensando…";
  } else {
    state.textContent = "";
  }
  notice.replaceChildren();
  notice.hidden = true;
  const isLast = S.ui.messages.lastElementChild === el;
  model.retryShown = false;
  if (model.status === "error" || model.status === "stopped") {
    model.retryShown = isLast;
    const text = model.status === "stopped" ? "Resposta interrompida." : REPLY_ERRORS[model.error] || REPLY_ERRORS.model_error;
    notice.hidden = false;
    notice.className = `msg__notice${model.status === "error" ? " is-error" : ""}`;
    notice.append(h("span", { text }));
    if (isLast) {
      notice.append(
        h("button.msg__retry", { type: "button", onclick: () => retry(model) }, icon("retry"), h("span", { text: model.status === "stopped" ? "Gerar de novo" : "Tentar de novo" })),
      );
    }
  } else if (model.status === "complete" && model.stop === "length") {
    notice.hidden = false;
    notice.className = "msg__notice";
    notice.append(h("span", { text: "Resposta cortada pelo limite de tamanho." }));
  }
  model.parts.actions.hidden = streaming || !model.content;
  if (model.thinking && model.parts.thinking.hidden) model.parts.thinking.hidden = false;
  const label = model.parts.thinking.querySelector(".think__label");
  if (label) label.textContent = streaming && !model.content ? "Pensando…" : "Raciocínio";
}

// ---------- Streaming ----------

let renderQueued = new Set();
let renderFrame = 0;

function queueRender(model) {
  renderQueued.add(model);
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    const batch = renderQueued;
    renderQueued = new Set();
    for (const item of batch) {
      if (!item.el.isConnected) continue;
      item.view.update(item.content);
      if (item.thinking) {
        item.parts.thinking.hidden = false;
        item.parts.thinkBody.textContent = item.thinking;
      }
      applyStatus(item);
    }
    if (S.pinned) scrollToBottom(false);
  });
}

function handleEvent(model, event) {
  if (typeof event.i === "number" && S.live && S.live.replyId === model.id) S.live.lastIndex = event.i;
  if (event.type === "delta") {
    model.content += event.text;
    model.searching = false;
    model.reconnecting = false;
    queueRender(model);
  } else if (event.type === "thinking") {
    model.thinking = (model.thinking || "") + event.text;
    queueRender(model);
  } else if (event.type === "searching") {
    model.searching = true;
    queueRender(model);
  } else if (event.type === "title") {
    applyTitle(event.conversation_id, event.title);
  } else if (event.type === "step") {
    // O KAZER conta o que está fazendo enquanto faz.
    model.steps = [...(model.steps || []), event.label].slice(-6);
    paintSteps(model);
  } else if (event.type === "artifacts") {
    // A resposta rendeu peças para a Biblioteca.
    model.artifacts = event.items;
    window.dispatchEvent(new CustomEvent("kazer:artifacts"));
    paintArtifacts(model);
  } else if (event.type === "done") {
    finish(model, event.reply);
    return "done";
  } else if (event.type === "pending") {
    return "pending";
  }
  return null;
}

function finish(model, reply) {
  Object.assign(model, {
    status: reply.status,
    error: reply.error,
    stop: reply.stop,
    content: reply.content ?? model.content,
    thinking: reply.thinking ?? model.thinking,
    searching: false,
    reconnecting: false,
  });
  model.view.update(model.content || "");
  if (model.thinking) model.parts.thinkBody.replaceChildren(renderMarkdown(model.thinking));
  applyStatus(model);
  if (S.live?.replyId === model.id) {
    S.live = null;
    setStreamingUi(false);
  }
  if (S.pinned) window.requestAnimationFrame(() => scrollToBottom(false));
  announce(model.status === "complete" ? "Resposta pronta." : "A resposta não foi concluída.");
}

// Lê o stream até o fim; devolve "done", "pending" ou "broken" (queda de rede).
async function pump(model, response) {
  try {
    for await (const event of readEvents(response)) {
      const outcome = handleEvent(model, event);
      if (outcome) return outcome;
    }
  } catch {
    if (S.live?.controller.signal.aborted) return "aborted";
    net.report();
  }
  return S.live?.controller.signal.aborted ? "aborted" : "broken";
}

// Reata uma resposta em geração depois de queda, recarga ou troca de aba.
async function resume(replyId, after) {
  const model = S.models.get(replyId);
  if (!model) return;
  const controller = new AbortController();
  S.live = { replyId, lastIndex: after, controller };
  setStreamingUi(true);
  for (let attemptNumber = 0; attemptNumber < 30; attemptNumber += 1) {
    if (S.live?.replyId !== replyId) return;
    if (net.status === "offline") {
      model.reconnecting = true;
      queueRender(model);
      await waitOnline();
    }
    try {
      const response = await fetch(`/api/messages/${replyId}/stream?after=${S.live.lastIndex}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("kazer:unauthenticated"));
        return;
      }
      if (!response.ok) break;
      const outcome = await pump(model, response);
      if (outcome === "done" || outcome === "aborted") return;
      if (outcome === "pending") {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        continue;
      }
    } catch {
      if (controller.signal.aborted) return;
      net.report();
    }
    model.reconnecting = true;
    queueRender(model);
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(8000, 600 * 2 ** attemptNumber)));
  }
  // Não deu para reatar: mostra o que o servidor gravou.
  const result = await request(`/api/messages/${replyId}`);
  if (result.ok && S.models.get(replyId) === model) finish(model, result.data.message);
}

function setStreamingUi(on) {
  S.ui.send.classList.toggle("is-stop", on);
  S.ui.send.setAttribute("aria-label", on ? "Parar resposta" : "Enviar");
  updateSendState();
}

// ---------- Envio ----------

function readyAttachments() {
  return S.attachments.filter((item) => item.status === "ready");
}

function canSend() {
  if (S.sending || S.live) return false;
  if (!S.model?.available) return false;
  if (S.attachments.some((item) => item.status === "uploading")) return false;
  return Boolean(S.ui.prompt.value.trim() || readyAttachments().length);
}

function updateSendState() {
  const streaming = Boolean(S.live);
  S.ui.send.disabled = streaming ? false : !canSend();
  S.ui.send.setAttribute("aria-busy", String(S.sending));
}

function showAlert(text) {
  S.ui.composerAlertText.textContent = text;
  S.ui.composerAlert.hidden = false;
}

function hideAlert() {
  S.ui.composerAlert.hidden = true;
  S.ui.composerAlertText.textContent = "";
}

async function send() {
  if (S.live) {
    stop();
    return;
  }
  if (!canSend()) return;
  if (dictation?.listening) dictation.stop();
  hideAlert();
  const content = S.ui.prompt.value.trim();
  const files = readyAttachments();
  const attachmentIds = files.map((item) => item.id);
  // Mesmo conteúdo depois de uma falha: mesmo client_id (o servidor deduplica).
  const fingerprint = JSON.stringify([S.conversation?.id || null, content, attachmentIds]);
  const clientId = S.lastAttempt?.fingerprint === fingerprint ? S.lastAttempt.clientId : uuid();
  S.lastAttempt = { fingerprint, clientId };

  S.sending = true;
  S.ui.prompt.readOnly = true;
  S.ui.composerBox.classList.add("is-sending");
  updateSendState();

  const controller = new AbortController();
  const token = S.navToken;
  let response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({
        client_id: clientId,
        conversation_id: S.conversation?.id || null,
        content,
        attachments: attachmentIds,
        model: "kaz-1.1",
        effort: S.options.effort,
        tools: { web_search: S.options.web, research: false, memory: S.options.memory },
        forja: S.forja,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: controller.signal,
    });
  } catch {
    net.report();
    failSend({ error: "network" });
    return;
  }
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (response.status === 401) window.dispatchEvent(new CustomEvent("kazer:unauthenticated"));
    failSend({ error: "server", ...data });
    return;
  }

  // Primeiro evento confirma que a mensagem foi aceita e gravada.
  const reader = readEvents(response);
  let first;
  try {
    first = (await reader.next()).value;
  } catch {
    first = undefined;
  }
  if (!first || first.type !== "start") {
    failSend({ error: "network" });
    return;
  }
  S.lastAttempt = null;
  S.sending = false;
  S.ui.prompt.readOnly = false;
  S.ui.composerBox.classList.remove("is-sending");
  if (token !== S.navToken) {
    // A pessoa já trocou de conversa: a resposta segue sendo gerada e gravada no servidor.
    controller.abort();
    return;
  }

  commitSend(first);
  const model = S.models.get(first.reply.id);
  S.live = { replyId: model.id, lastIndex: -1, controller };
  setStreamingUi(true);
  let outcome = "broken";
  try {
    for await (const event of reader) {
      const result = handleEvent(model, event);
      if (result) {
        outcome = result;
        break;
      }
    }
  } catch {
    if (!controller.signal.aborted) net.report();
  }
  if (outcome === "done" || controller.signal.aborted) return;
  if (S.live?.replyId === model.id) {
    const after = S.live.lastIndex;
    S.live = null;
    resume(model.id, after);
  }
}

function failSend(data) {
  S.sending = false;
  S.ui.prompt.readOnly = false;
  S.ui.composerBox.classList.remove("is-sending");
  updateSendState();
  if (data.error === "unauthenticated") return;
  showAlert(sendError(data));
  if (data.error === "usage_limit") offerPlans(data);
  if (data.error === "plan_required") offerFeature(data);
  if (data.error === "not_found") {
    newConversation({ push: true, focus: false });
  }
  // O servidor mudou a oferta de esforços: volta ao Baixo em vez de travar o envio.
  if (data.error === "invalid_effort") setEffort("baixo", { quiet: true });
}

function commitSend(event) {
  const isNew = !S.conversation;
  S.conversation = event.conversation;
  if (isNew) {
    window.history.pushState({ chat: event.conversation.id }, "", `/c/${event.conversation.id}`);
    tabStore.set("kazer:draft:new", null);
  }
  setTitle(event.conversation.title);
  upsertHistory(event.conversation);
  if (S.forja && S.prefs && !S.prefs.code_sessions?.includes(event.conversation.id)) {
    S.prefs.code_sessions = [event.conversation.id, ...(S.prefs.code_sessions || [])].slice(0, 30);
  }
  // Limpa o composer só agora: a mensagem já está salva no servidor.
  S.ui.prompt.value = "";
  saveDraft();
  autosize();
  clearTray({ keepServer: true });
  leaveEmpty();
  if (!event.duplicate || !S.models.has(event.message.id)) {
    const message = { ...event.message };
    renderPage([message, event.reply], S.hasMore, {});
    for (const id of [event.message.id, event.reply.id]) S.models.get(id)?.el.classList.add("is-new");
    const reply = S.models.get(event.reply.id);
    if (reply) paintBody(reply);
  }
  scrollToBottom(true);
  updateSendState();
}

async function stop() {
  if (!S.live) return;
  const replyId = S.live.replyId;
  S.ui.send.disabled = true;
  const result = await request(`/api/messages/${replyId}/stop`, { body: {} });
  if (!result.ok && result.data.error !== "not_found") toast("Não deu para parar agora.");
  updateSendState();
}

async function retry(model) {
  if (S.live || S.sending) return;
  const controller = new AbortController();
  let response;
  try {
    response = await fetch(`/api/messages/${model.id}/retry`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      signal: controller.signal,
    });
  } catch {
    net.report();
    toast(SEND_ERRORS.network);
    return;
  }
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    toast(sendError(data));
    if (data.error === "usage_limit") offerPlans(data);
    return;
  }
  Object.assign(model, { status: "streaming", content: "", thinking: "", error: null, stop: null });
  model.view.clear();
  model.parts.thinking.hidden = true;
  model.parts.thinkBody.replaceChildren();
  applyStatus(model);
  S.live = { replyId: model.id, lastIndex: -1, controller };
  setStreamingUi(true);
  const outcome = await pump(model, response);
  if (outcome === "broken" && S.live?.replyId === model.id) {
    const after = S.live.lastIndex;
    S.live = null;
    resume(model.id, after);
  }
}

// ---------- Composer ----------

function draftKey() {
  return `kazer:draft:${S.conversation?.id || "new"}`;
}

function saveDraft() {
  tabStore.set(draftKey(), S.ui.prompt.value);
}

function restoreDraft() {
  S.ui.prompt.value = tabStore.get(draftKey()) || "";
  autosize();
  updateSendState();
}

function autosize() {
  const area = S.ui.prompt;
  area.style.height = "auto";
  const max = Math.max(120, Math.round(window.innerHeight * 0.36));
  area.style.height = `${Math.min(area.scrollHeight, max)}px`;
  area.classList.toggle("is-scrolling", area.scrollHeight > max);
}

function bindComposer() {
  const { prompt, composer } = S.ui;
  prompt.addEventListener("input", () => {
    autosize();
    saveDraft();
    updateSendState();
    S.ui.empty.classList.toggle("is-typing", Boolean(prompt.value));
  });
  prompt.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const force = event.ctrlKey || event.metaKey;
    const enterSends = !coarse.matches && S.prefs.send_on_enter !== false;
    if (force || (enterSends && !event.shiftKey)) {
      event.preventDefault();
      send();
    }
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
  S.ui.composerAlertClose.addEventListener("click", hideAlert);
  S.ui.plus.addEventListener("click", () => openPlusSheet());
  S.ui.mic.addEventListener("click", () => toggleDictation());
  S.ui.modelChip.addEventListener("click", () => openModelSheet());
  for (const [input, source] of [
    [S.ui.pickCamera, "camera"],
    [S.ui.pickPhotos, "photos"],
    [S.ui.pickFiles, "files"],
  ]) {
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      addFiles(files, source);
      prompt.focus({ preventScroll: true });
    });
  }
  // Colar imagem direto no campo.
  prompt.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      addFiles(files, "paste");
    }
  });
  // Arrastar arquivos para a conversa (desktop).
  S.ui.pane.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
      S.ui.pane.classList.add("is-dropping");
    }
  });
  S.ui.pane.addEventListener("dragleave", (event) => {
    if (event.target === S.ui.pane || !S.ui.pane.contains(event.relatedTarget)) S.ui.pane.classList.remove("is-dropping");
  });
  S.ui.pane.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    S.ui.pane.classList.remove("is-dropping");
    addFiles([...event.dataTransfer.files], "drop");
  });
  restoreDraft();
}

let dictation = null;

async function toggleDictation() {
  const { createDictation, dictationSupported, DICTATION_ERRORS } = await import("./voice.js");
  if (!dictationSupported) {
    toast("Este navegador não tem reconhecimento de fala. No celular, o teclado costuma ter um microfone.", {
      duration: 5200,
    });
    return;
  }
  if (dictation?.listening) {
    dictation.stop();
    return;
  }
  if (!dictation) {
    dictation = createDictation({
      onText: (text, interim) => {
        S.ui.prompt.value = text;
        S.ui.composerBox.classList.toggle("is-hearing", interim);
        autosize();
        updateSendState();
        S.ui.empty.classList.toggle("is-typing", Boolean(text));
      },
      onState: (state) => {
        const on = state !== "idle";
        S.ui.mic.setAttribute("aria-pressed", String(on));
        S.ui.mic.classList.toggle("is-listening", state === "listening");
        S.ui.mic.setAttribute("aria-label", on ? "Parar de ditar" : "Ditar por voz");
        S.ui.composerBox.classList.toggle("is-dictating", on);
        if (!on) {
          S.ui.composerBox.classList.remove("is-hearing");
          saveDraft();
        }
      },
      onError: (code) => toast(DICTATION_ERRORS[code] || "O ditado parou. Tente de novo.", { duration: 4200 }),
    });
  }
  // Uma vez por navegador: o áudio é transcrito pelo serviço do navegador.
  if (!store.get("kazer:voice-note", false)) {
    store.set("kazer:voice-note", true);
    toast("Seu navegador transcreve a fala; o KAZER recebe só o texto.", { duration: 5000 });
  }
  const current = S.ui.prompt.value.trim();
  dictation.start(current ? current + " " : "");
}

// ---------- Esforço ----------

const EFFORT_LEVELS = [
  ["baixo", "Baixo", "Respostas rápidas, para o dia a dia."],
  ["medio", "Médio", "Equilíbrio entre velocidade e capricho."],
  ["alto", "Alto", "Mais completo; leva um pouco mais de tempo."],
  ["extra", "Extra", "Para tarefas difíceis e raciocínio longo."],
  ["max", "Máx", "O mais fundo que o KAZ 1.1 alcança."],
];

// Os níveis que o servidor realmente diferencia (nunca uma lista inventada aqui).
function offeredEfforts() {
  const offered = S.model?.efforts;
  const known = new Map(EFFORT_LEVELS.map(([id, label, about]) => [id, { id, label, about }]));
  if (!Array.isArray(offered) || !offered.length) return [known.get("baixo")];
  return offered.map((item) => known.get(item.id)).filter(Boolean);
}

function effortLabel() {
  return offeredEfforts().find((item) => item.id === S.options.effort)?.label || "Baixo";
}

function paintEffort() {
  const label = effortLabel();
  const chip = S.ui.modelChip.querySelector(".chip__effort");
  if (chip) chip.textContent = label;
  S.ui.modelChip.setAttribute("aria-label", `Modelo KAZ 1.1, esforço ${label}`);
}

function setEffort(id, { quiet = false } = {}) {
  S.options.effort = id;
  store.set("kazer:effort", id);
  paintEffort();
  if (!quiet) toast(`Esforço ${effortLabel()}.`, { duration: 1600 });
}

// ---------- Anexos ----------

const MAX_SIDE = 2048;

// Fotos grandes são reduzidas e regravadas no aparelho: menos dados na rede e
// sem metadados de localização (EXIF) indo para o servidor.
async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || !("createImageBitmap" in window)) return file;
  const big = file.size > 1.5 * 1024 * 1024;
  const convert = /^image\/(jpeg|heic|heif)$/.test(file.type);
  if (!convert && !big) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const type = file.type === "image/png" && !big ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
    if (!blob) return file;
    const name = type === "image/jpeg" ? file.name.replace(/\.(png|webp|jpe?g|heic|heif)$/i, "") + ".jpg" : file.name;
    return new File([blob], name, { type });
  } catch {
    return file;
  }
}

function addFiles(files, source) {
  hideAlert();
  const max = S.model?.limits?.max_attachments || 6;
  const room = max - S.attachments.length;
  if (room <= 0) {
    showAlert(`No máximo ${max} anexos por mensagem.`);
    return;
  }
  if (files.length > room) showAlert(`Só ${room} anexo${room > 1 ? "s" : ""} couberam nesta mensagem.`);
  for (const file of files.slice(0, room)) {
    const isImage = file.type.startsWith("image/");
    if (isImage && !S.model?.features?.images) {
      showAlert(UPLOAD_ERRORS.images_unavailable);
      continue;
    }
    const item = {
      localId: uuid(),
      name: file.name || (source === "camera" ? "foto.jpg" : "arquivo"),
      size: file.size,
      kind: isImage ? "image" : file.type === "application/pdf" ? "pdf" : "text",
      status: "uploading",
      progress: 0,
      preview: isImage ? URL.createObjectURL(file) : null,
      xhr: null,
      id: null,
    };
    S.attachments.push(item);
    renderTray();
    upload(item, file);
  }
  updateSendState();
}

async function upload(item, original) {
  const file = item.kind === "image" ? await prepareImage(original) : original;
  if (!S.attachments.includes(item)) return;
  item.size = file.size;
  const xhr = new XMLHttpRequest();
  item.xhr = xhr;
  xhr.open("POST", "/api/attachments");
  xhr.responseType = "json";
  xhr.timeout = 120000;
  xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(item.name));
  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
      item.progress = event.loaded / event.total;
      paintTrayItem(item);
    }
  });
  const done = (ok, data) => {
    item.xhr = null;
    if (!S.attachments.includes(item)) return;
    if (ok) {
      Object.assign(item, { status: "ready", id: data.attachment.id, kind: data.attachment.kind, name: data.attachment.name });
    } else {
      item.status = "error";
      item.error = UPLOAD_ERRORS[data?.error] || "Não deu para anexar este arquivo.";
      showAlert(`${item.name}: ${item.error}`);
      if (data?.error === "unauthenticated") window.dispatchEvent(new CustomEvent("kazer:unauthenticated"));
    }
    paintTrayItem(item);
    updateSendState();
  };
  xhr.addEventListener("load", () => done(xhr.status === 201, xhr.response || {}));
  xhr.addEventListener("error", () => {
    net.report();
    done(false, { error: "network" });
  });
  xhr.addEventListener("timeout", () => done(false, { error: "network" }));
  xhr.send(file);
}

function renderTray() {
  const tray = S.ui.tray;
  tray.hidden = S.attachments.length === 0;
  const keep = new Set(S.attachments.map((item) => item.localId));
  for (const node of [...tray.children]) if (!keep.has(node.dataset.local)) node.remove();
  for (const item of S.attachments) {
    if (!item.el) item.el = trayElement(item);
    if (!item.el.isConnected) tray.append(item.el);
    paintTrayItem(item);
  }
}

function trayElement(item) {
  const remove = h("button.tray__remove", { type: "button", "aria-label": `Remover ${item.name}` }, icon("close"));
  remove.addEventListener("click", () => removeAttachment(item));
  const visual = item.preview
    ? h("img.tray__thumb", { src: item.preview, alt: "" })
    : h("span.tray__doc", {}, icon("file"), h("span.tray__ext", { text: (item.name.split(".").pop() || "").slice(0, 4).toUpperCase() }));
  return h(
    `li.tray__item${item.preview ? ".tray__item--image" : ""}`,
    { dataset: { local: item.localId } },
    visual,
    item.preview ? null : h("span.tray__meta", {}, h("span.tray__name", { text: item.name }), h("span.tray__size")),
    h("span.tray__ring", { "aria-hidden": "true" }),
    remove,
  );
}

function paintTrayItem(item) {
  if (!item.el) return;
  item.el.classList.toggle("is-uploading", item.status === "uploading");
  item.el.classList.toggle("is-error", item.status === "error");
  item.el.style.setProperty("--progress", String(item.progress || 0));
  const size = item.el.querySelector(".tray__size");
  if (size) size.textContent = item.status === "error" ? "Falhou" : item.status === "uploading" ? "Enviando…" : formatBytes(item.size);
  item.el.title = item.status === "error" ? item.error : item.name;
}

async function removeAttachment(item) {
  S.attachments = S.attachments.filter((other) => other !== item);
  item.xhr?.abort();
  if (item.preview) URL.revokeObjectURL(item.preview);
  renderTray();
  updateSendState();
  S.ui.prompt.focus({ preventScroll: true });
  if (item.id) request(`/api/attachments/${item.id}`, { method: "DELETE" });
}

function clearTray({ keepServer = false } = {}) {
  for (const item of S.attachments) {
    item.xhr?.abort();
    // As prévias locais (blob:) somem; as imagens enviadas passam a vir do servidor.
    if (item.preview) window.setTimeout(() => URL.revokeObjectURL(item.preview), 30000);
    if (!keepServer && item.id) request(`/api/attachments/${item.id}`, { method: "DELETE" });
  }
  S.attachments = [];
  renderTray();
}

// ---------- Folhas: modelo, esforço, + e conectores ----------

// Níveis de esforço: só o Baixo está liberado; os outros aparecem bloqueados
// até a decisão de liberar (o servidor também só aceita "baixo").

function pressable(row, run) {
  row.addEventListener("click", run);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run();
    }
  });
  return row;
}

// "Selecionar modelo": só o KAZ 1.1 e, abaixo, a linha que leva ao esforço.
function openModelSheet() {
  const available = S.model?.available;
  openSheet({
    title: "Selecionar modelo",
    opener: S.ui.modelChip,
    content: (handle) => {
      const model = pressable(
        h(
          "div.pick-row",
          { role: "radio", "aria-checked": "true", tabindex: "0" },
          h(
            "span.pick-row__text",
            {},
            h("span.pick-row__title", { text: "KAZ 1.1" }),
            h("span.pick-row__desc", {
              text: available ? "O modelo do KAZER para o dia a dia." : "Ainda não conectado a um provedor neste servidor.",
            }),
          ),
          icon("check", "pick-row__check"),
        ),
        () => handle.close(),
      );
      const effort = h(
        "button.pick-row.pick-row--link",
        { type: "button", onclick: () => openEffortSheet() },
        h("span.pick-row__title", { text: "Esforço" }),
        h("span.pick-row__value", { text: effortLabel() }),
        icon("chevron-right", "pick-row__go"),
      );
      return h(
        "div.model-sheet",
        {},
        h("div.pick-group", { role: "radiogroup", "aria-label": "Modelo" }, model),
        h("div.pick-group", {}, effort),
      );
    },
  });
}

function openEffortSheet() {
  openSheet({
    title: "Esforço",
    opener: S.ui.modelChip,
    back: () => openModelSheet(),
    content: (handle) => {
      const rows = offeredEfforts().map(({ id, label, about }) => {
        const on = id === S.options.effort;
        const row = h(
          "div.pick-row",
          { role: "radio", "aria-checked": String(on), tabindex: "0", dataset: { effort: id } },
          h("span.pick-row__text", {}, h("span.pick-row__title", { text: label }), h("span.pick-row__desc", { text: about })),
          on ? icon("check", "pick-row__check") : null,
        );
        return pressable(row, () => {
          setEffort(id);
          handle.close();
        });
      });
      const many = rows.length > 1;
      return h(
        "div.model-sheet",
        {},
        h("div.pick-group", { role: "radiogroup", "aria-label": "Esforço" }, rows),
        h("p.sheet__note", {
          text: many
            ? "Cada nível usa um modelo diferente: mais esforço dá respostas mais completas, mas leva mais tempo e gasta mais do seu limite."
            : "Este servidor só oferece o esforço Baixo.",
        }),
      );
    },
  });
}

function toggleRow({ id, icon: iconName, title, description, checked, disabled, onChange }) {
  const input = h("input.switch__input", { type: "checkbox", role: "switch", id, checked, disabled });
  input.addEventListener("change", () => onChange(input.checked));
  return h(
    `label.tool-row${disabled ? ".is-disabled" : ""}`,
    { for: id },
    h("span.tool-row__icon", {}, icon(iconName)),
    h("span.tool-row__text", {}, h("span.tool-row__title", { text: title }), h("span.tool-row__desc", { text: description })),
    h("span.switch", {}, input, h("span.switch__track", { "aria-hidden": "true" }, h("span.switch__thumb"))),
  );
}

function openPlusSheet() {
  const features = S.model?.features || {};
  const available = Boolean(S.model?.available);
  const pickers = [
    coarse.matches ? ["camera", "camera", "Câmera", S.ui.pickCamera, features.images] : null,
    ["photos", "image", "Fotos", S.ui.pickPhotos, features.images],
    ["files", "file", "Arquivos", S.ui.pickFiles, available],
  ].filter(Boolean);
  openSheet({
    title: "Adicionar à conversa",
    opener: S.ui.plus,
    content: (handle) => {
      const tiles = h(
        "div.pick",
        {},
        pickers.map(([key, iconName, label, input, enabled]) =>
          h(
            "button.pick__tile",
            {
              type: "button",
              disabled: !enabled,
              dataset: { pick: key },
              onclick: () => {
                handle.close({ restore: false });
                input.click();
              },
            },
            h("span.pick__icon", {}, icon(iconName)),
            h("span.pick__label", { text: label }),
            enabled ? null : h("span.pick__off", { text: "Indisponível" }),
          ),
        ),
      );
      const memoryAvailable = S.prefs.memory_enabled !== false;
      const list = h(
        "div.tools",
        {},
        toggleRow({
          id: "tool-research",
          icon: "research",
          title: "Pesquisa",
          description: features.research ? "Investigação em várias etapas." : "Ainda não disponível neste KAZER.",
          checked: false,
          disabled: !features.research,
          onChange: () => {},
        }),
        toggleRow({
          id: "tool-web",
          icon: "globe",
          title: "Busca na web",
          description: features.web_search ? "Procura informação atual e cita as fontes." : "Indisponível com o modelo atual.",
          checked: S.options.web,
          disabled: !features.web_search,
          onChange: (on) => {
            S.options.web = on;
            S.ui.plus.classList.toggle("is-active", on);
          },
        }),
        connectorRow(),
        toggleRow({
          id: "tool-memory",
          icon: "memory",
          title: "Memória",
          description: memoryAvailable ? "Usar o que você salvou nas configurações." : "Desligada nas configurações.",
          checked: S.options.memory && memoryAvailable,
          disabled: !memoryAvailable,
          onChange: (on) => {
            S.options.memory = on;
          },
        }),
      );
      return h("div.plus", {}, tiles, list);
    },
  });
}

// Linha de conectores: mostra o estado real da conta, não um texto fixo.
function connectorRow() {
  const row = h(
    "button.tool-row.tool-row--link",
    { type: "button", onclick: () => openConnectorsSheet() },
    h("span.tool-row__icon", {}, icon("plug")),
    h(
      "span.tool-row__text",
      {},
      h("span.tool-row__title", { text: "Conectores" }),
      h("span.tool-row__desc", { text: "Conferindo…" }),
    ),
    icon("chevron-right", "tool-row__go"),
  );
  loadConnections().then((items) => {
    if (!row.isConnected) return;
    const on = items.filter((item) => item.enabled !== false).length;
    const desc = row.querySelector(".tool-row__desc");
    if (desc) {
      desc.textContent = on
        ? `${on} ligado${on > 1 ? "s" : ""}: as ferramentas entram nesta conversa.`
        : "Nenhum conector ligado.";
    }
  });
  return row;
}

async function loadConnections() {
  const result = await request("/api/connections");
  S.connections = result.ok && Array.isArray(result.data?.items) ? result.data.items : [];
  return S.connections;
}

function openConnectorsSheet() {
  openSheet({
    title: "Conectores",
    opener: S.ui.plus,
    back: () => openPlusSheet(),
    content: () => {
      const body = h("div.connectors", {}, h("p.connectors__text", { text: "Conferindo seus conectores…" }));
      loadConnections().then((items) => {
        if (!body.isConnected) return;
        if (!items.length) {
          body.replaceChildren(
            h("span.connectors__icon", {}, icon("plug")),
            h("p.connectors__title", { text: "Nenhum conector ligado." }),
            h("p.connectors__text", {
              text: "Conectores ligam o KAZER a outros serviços com a sua autorização. Ligue um em Configurações › Conectores e as ferramentas dele passam a valer nas conversas.",
            }),
          );
          return;
        }
        body.replaceChildren(
          h("div.tools", {},
            items.map((item) => {
              const count = Array.isArray(item.tools) ? item.tools.length : 0;
              const ligado = item.enabled !== false;
              return h(
                "div.tool-row",
                {},
                h("span.tool-row__icon", {}, icon("plug")),
                h(
                  "span.tool-row__text",
                  {},
                  h("span.tool-row__title", { text: item.name || item.connector_id }),
                  h("span.tool-row__desc", {
                    text: `${count} ferramenta${count === 1 ? "" : "s"}${ligado ? "" : " · desligado"}`,
                  }),
                ),
                ligado ? icon("check", "tool-row__go") : null,
              );
            }),
          ),
          h("p.connectors__text", { text: "Ligar, desligar e apagar fica em Configurações › Conectores." }),
        );
      });
      return body;
    },
  });
}

// ---------- Atalhos de teclado (computador) ----------
//
// O computador ganha o que o celular não tem como ter: comando pelo teclado.
// Nada aqui some do celular — são habilidades a mais, não um caminho
// diferente. Os atalhos só respondem em tela de computador e nunca quando a
// pessoa está escrevendo num campo.

const SHORTCUTS = [
  { keys: "Ctrl K", mac: "⌘K", about: "Paleta de comandos" },
  { keys: "Ctrl B", mac: "⌘B", about: "Abrir e fechar a gaveta" },
  { keys: "Ctrl Shift O", mac: "⌘⇧O", about: "Nova conversa" },
  { keys: "Ctrl Shift F", mac: "⌘⇧F", about: "Nova conversa no KZ Code" },
  { keys: "Esc", mac: "Esc", about: "Fechar o que estiver aberto" },
];

const onMac = () => /mac/i.test(navigator.platform || navigator.userAgent || "");
const keyLabel = (item) => (onMac() ? item.mac : item.keys);

// Digitando num campo, o atalho é do campo, não do app.
function typing(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function bindShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (!desktopQuery.matches || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k") {
      event.preventDefault();
      openPalette();
    } else if (key === "b") {
      event.preventDefault();
      if (S.root.classList.contains("drawer-open")) closeDrawer();
      else openDrawer({ focus: false });
    } else if (event.shiftKey && key === "o") {
      event.preventDefault();
      newConversation({ push: true, focus: true });
    } else if (event.shiftKey && key === "f") {
      event.preventDefault();
      startForja();
    } else if (key === "k" || key === "b") {
      event.preventDefault();
    }
    // Campo de texto: Ctrl+K e Ctrl+B do navegador não valem mais aqui, mas
    // tudo o que não está na lista continua passando direto.
  });
}

// Grupos da paleta: ações primeiro, depois as seções, como numa paleta de
// editor. Quem executa é o app; a paleta só mostra e chama.
function paletteGroups() {
  const go = (name) => () => showScreen(name);
  return [
    {
      label: "Ações",
      items: [
        {
          label: "Nova conversa",
          glyph: "plus",
          hint: keyLabel(SHORTCUTS[2]),
          run: () => newConversation({ push: true, focus: true }),
        },
        { label: "Nova conversa no KZ Code", glyph: "code", hint: keyLabel(SHORTCUTS[3]), run: startForja },
        { label: "Configurações", glyph: "gear", run: () => openSettings() },
        { label: "Skills", glyph: "sparkle", run: () => openSettings("skills") },
        { label: "Terminal", glyph: "terminal", run: () => openSettings("terminal") },
        { label: "Planos", glyph: "bolt", run: () => offerPlans({}) },
        {
          label: "Gaveta",
          glyph: "menu",
          hint: keyLabel(SHORTCUTS[1]),
          run: () => (S.root.classList.contains("drawer-open") ? closeDrawer() : openDrawer({ focus: false })),
        },
      ],
    },
    {
      label: "Ir para",
      items: SCREENS.map((name) => ({
        label: SCREEN_LABELS[name] || name,
        glyph: SCREEN_GLYPHS[name] || "chevron-right",
        run: go(name),
      })),
    },
    {
      label: "Atalhos",
      items: SHORTCUTS.map((item) => ({
        label: item.about,
        glyph: "info",
        hint: keyLabel(item),
        about: "atalho teclado",
        run: () => {},
      })),
    },
  ];
}

async function openPalette() {
  try {
    const { openPalette: show, paletteOpen } = await import("./palette.js");
    if (paletteOpen()) return;
    await show({
      groups: paletteGroups(),
      onOpenConversation: (id) => {
        showScreen("conversas");
        openConversation(id);
      },
    });
  } catch {
    toast("Não deu para abrir os comandos agora.");
  }
}

// ---------- Gaveta e histórico ----------

function bindDrawer() {
  S.ui.menu.addEventListener("click", () => (S.root.classList.contains("drawer-open") ? closeDrawer() : openDrawer()));
  S.ui.drawerClose.addEventListener("click", () => closeDrawer());
  S.ui.drawerScrim.addEventListener("click", () => closeDrawer());
  S.ui.newChat.addEventListener("click", () => newConversation());
  S.ui.newChatTop.addEventListener("click", () => newConversation());
  S.ui.openSettings.addEventListener("click", () => openSettings());
  S.ui.signOut.addEventListener("click", () => signOut());
  S.ui.drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !desktopQuery.matches) closeDrawer();
    else if (!desktopQuery.matches && S.root.classList.contains("drawer-open")) trapFocus(S.ui.drawer, event);
  });
  let timer = 0;
  S.ui.drawerNav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-screen]");
    if (item) showScreen(item.dataset.screen);
  });
  S.ui.forjaChip.addEventListener("click", () => setForja(false));
  // O atalho fica à vista para quem nunca leu atalho nenhum.
  S.ui.openPalette.addEventListener("click", () => openPalette());
  if (onMac()) S.ui.openPalette.querySelector("kbd").textContent = "⌘K";
  S.ui.historySearch.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => loadHistory({ query: S.ui.historySearch.value.trim() }), 260);
  });
  S.ui.historyList.addEventListener("click", (event) => {
    const link = event.target.closest(".hist__link");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const id = link.dataset.id;
    if (id === S.conversation?.id) {
      if (!desktopQuery.matches) closeDrawer();
      return;
    }
    openConversation(id);
  });
  historyObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadHistory({ more: true });
    },
    { root: S.ui.history, rootMargin: "200px" },
  );
  historyObserver.observe(S.ui.historyMore);
  desktopQuery.addEventListener("change", () => {
    S.ui.pane.inert = false;
    S.ui.drawerScrim.hidden = true;
    if (desktopQuery.matches && store.get("kazer:drawer", true)) openDrawer({ focus: false });
    else closeDrawer({ focus: false, remember: false });
  });
  // Arrastar a gaveta para a esquerda fecha (toque).
  let startX = 0;
  let dx = 0;
  let dragging = false;
  S.ui.drawer.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || desktopQuery.matches) return;
    dragging = true;
    startX = event.clientX;
    dx = 0;
  });
  S.ui.drawer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dx = Math.min(0, event.clientX - startX);
    if (dx < -8) S.ui.drawer.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    S.ui.drawer.style.transform = "";
    if (dx < -70) closeDrawer();
  };
  S.ui.drawer.addEventListener("pointerup", end);
  S.ui.drawer.addEventListener("pointercancel", end);
}

function openDrawer({ focus = true } = {}) {
  S.root.classList.add("drawer-open");
  S.ui.menu.setAttribute("aria-expanded", "true");
  S.ui.menu.setAttribute("aria-label", "Fechar conversas");
  if (desktopQuery.matches) store.set("kazer:drawer", true);
  else {
    S.ui.drawerScrim.hidden = false;
    S.ui.pane.inert = true;
  }
  if (!S.history.loaded) loadHistory({});
  if (focus && !desktopQuery.matches) window.requestAnimationFrame(() => S.ui.newChat.focus({ preventScroll: true }));
}

function closeDrawer({ focus = true, remember = true } = {}) {
  if (!S.root.classList.contains("drawer-open")) return;
  S.root.classList.remove("drawer-open");
  S.ui.menu.setAttribute("aria-expanded", "false");
  S.ui.menu.setAttribute("aria-label", "Abrir conversas");
  S.ui.drawerScrim.hidden = true;
  S.ui.pane.inert = false;
  if (desktopQuery.matches && remember) store.set("kazer:drawer", false);
  if (focus) S.ui.menu.focus({ preventScroll: true });
}

async function loadHistory({ query, more = false }) {
  const history = S.history;
  if (more && (!history.next || history.loading)) return;
  if (query !== undefined) history.query = query;
  history.loading = true;
  S.ui.history.classList.add("is-loading");
  const params = new URLSearchParams();
  if (more && history.next) params.set("cursor", history.next);
  if (history.query) params.set("q", history.query);
  const asked = history.query;
  const qs = params.toString();
  const result = await request(`/api/conversations${qs ? `?${qs}` : ""}`);
  history.loading = false;
  S.ui.history.classList.remove("is-loading");
  if (asked !== history.query) return; // busca mudou no meio do caminho
  if (!result.ok) {
    if (!more) {
      S.ui.historyEmpty.textContent =
        result.data.error === "chat_unavailable" ? "O histórico ainda não está disponível neste ambiente." : "Não deu para carregar as conversas.";
    }
    S.ui.historyEmpty.hidden = more;
    return;
  }
  history.loaded = true;
  history.items = more ? history.items.concat(result.data.items) : result.data.items;
  history.next = result.data.next;
  renderHistory();
}

function upsertHistory(conversation) {
  const items = S.history.items.filter((item) => item.id !== conversation.id);
  items.unshift(conversation);
  S.history.items = items;
  if (S.history.loaded) renderHistory();
}

function renderHistory() {
  const list = S.ui.historyList;
  const { items, query } = S.history;
  const fragment = document.createDocumentFragment();
  let group = null;
  let section = null;
  for (const item of items) {
    const name = dayGroup(item.updated_at);
    if (name !== group) {
      group = name;
      section = h("ul.hist", { "aria-label": name });
      fragment.append(h("h3.hist__group", { text: name }), section);
    }
    section.append(historyRow(item));
  }
  list.replaceChildren(fragment);
  S.ui.historyEmpty.hidden = items.length > 0;
  S.ui.historyEmpty.textContent = query ? "Nada encontrado com essa busca." : "Nenhuma conversa ainda. Comece uma e ela aparece aqui.";
  markActiveHistory();
}

function historyRow(item) {
  const more = h("button.hist__more", { type: "button", "aria-label": `Opções de “${item.title}”` }, icon("dots"));
  more.addEventListener("click", () => openConversationMenu(item, more));
  return h(
    "li.hist__row",
    { dataset: { id: item.id } },
    h("a.hist__link", { href: `/c/${item.id}`, dataset: { id: item.id }, text: item.title }),
    more,
  );
}

function markActiveHistory() {
  for (const row of S.ui.historyList.querySelectorAll(".hist__row")) {
    const active = row.dataset.id === S.conversation?.id;
    row.classList.toggle("is-active", active);
    const link = row.querySelector(".hist__link");
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function openConversationMenu(item, opener) {
  openSheet({
    title: item.title,
    opener,
    content: (handle) =>
      h(
        "div.menu-list",
        {},
        h("button.menu-item", { type: "button", onclick: () => renameConversation(item, handle, opener) }, icon("edit"), h("span", { text: "Renomear" })),
        h("button.menu-item.menu-item--danger", { type: "button", onclick: () => deleteConversation(item, handle, opener) }, icon("trash"), h("span", { text: "Apagar" })),
      ),
  });
}

async function renameConversation(item, handle, opener) {
  await handle.close({ restore: false });
  const title = await promptDialog({ title: "Renomear conversa", label: "Novo nome", value: item.title, opener });
  if (!title || title === item.title) return;
  const result = await request(`/api/conversations/${item.id}`, { body: { title } });
  if (!result.ok) {
    toast("Não deu para renomear agora.");
    return;
  }
  item.title = result.data.conversation.title;
  renderHistory();
  if (S.conversation?.id === item.id) {
    S.conversation.title = item.title;
    setTitle(item.title);
  }
}

async function deleteConversation(item, handle, opener) {
  await handle.close({ restore: false });
  const yes = await confirmDialog({
    title: "Apagar conversa?",
    body: `“${item.title}” e os anexos dela serão apagados para sempre.`,
    confirm: "Apagar",
    danger: true,
    opener,
  });
  if (!yes) return;
  const result = await request(`/api/conversations/${item.id}`, { method: "DELETE" });
  if (!result.ok && result.data.error !== "not_found") {
    toast("Não deu para apagar agora.");
    return;
  }
  S.history.items = S.history.items.filter((other) => other.id !== item.id);
  renderHistory();
  tabStore.set(`kazer:draft:${item.id}`, null);
  if (S.conversation?.id === item.id) newConversation({ push: false, focus: false });
  if (window.location.pathname === `/c/${item.id}`) window.history.replaceState({ chat: "new" }, "", "/");
  toast("Conversa apagada.");
}

// ---------- Configurações, sessão e rede ----------

async function openSettings(section = "") {
  if (!desktopQuery.matches) closeDrawer({ focus: false });
  try {
    const { openSettingsPanel } = await import("./settings.js");
    openSettingsPanel({
      opener: S.ui.openSettings,
      section,
      account: S.account,
      prefs: S.prefs,
      model: S.model,
      memories: S.memories || [],
      onPreferences: onPreferencesChanged,
      onMemories: (memories) => {
        S.memories = memories;
      },
      onHistoryCleared: () => {
        S.history.items = [];
        renderHistory();
        newConversation({ push: true, focus: false });
      },
      onSignOut: signOut,
      onAccountDeleted: () => leave("deleted"),
    });
  } catch {
    toast("Não deu para abrir as configurações agora.");
  }
}

async function signOut() {
  const result = await request("/api/auth/logout", { body: {} });
  if (!result.ok && result.data.error !== "unauthenticated") {
    toast("Não deu para sair agora. Verifique a conexão.");
    return;
  }
  leave("signed-out");
}

// Sai do chat recarregando a página: nenhuma conversa fica na memória da aba.
function leave(reason) {
  tabStore.clearPrefix("kazer:draft:");
  tabStore.set("kazer:after", reason);
  window.location.replace("/");
}

let expiredHandled = false;
function onExpired() {
  if (expiredHandled) return;
  expiredHandled = true;
  if (S.conversation) tabStore.set("kazer:return", `/c/${S.conversation.id}`);
  toast("Sua sessão expirou. Entre de novo para continuar.", { duration: 2600 });
  window.setTimeout(() => leave("expired"), 1600);
}

function onNetwork(status) {
  S.root?.classList.toggle("is-offline", status === "offline");
  if (status === "online" && S.root) {
    if (S.settingsFailed) loadSettings();
    if (!S.history.loaded && S.root.classList.contains("drawer-open")) loadHistory({});
    updateSendState();
  }
}

// Fecha folhas abertas quando a gaveta abre etc.
export function closeOverlays() {
  closeSheet();
}
