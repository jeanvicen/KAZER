// Chat do KAZER. Toda autorização acontece no servidor (cookie HttpOnly);
// aqui só há estado de interface. Respostas chegam em streaming (NDJSON) e,
// se a rede cair no meio, a interface reata do último evento recebido.

import { hydratePixelWords } from "./pixel.js";
import { initLanguage, locale, t } from "./i18n.js";
import { applyTheme } from "./theme.js";
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
import { bundleCard, citeChips, findQuestion, inlinePhotos, onAnswer, openImages, questionDock, picsStrip, readImages, readResearch, readSources, readSteps, renderSourceList, siteHost, sourceAvatar, stripSources } from "./deliver.js";
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
  model_tool_failed: "O modelo se enrolou com a pesquisa. Tente de novo.",
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
  plan_required: "Esse recurso entra com os planos pagos.",
  credits_exhausted: "Seu crédito de modelos premium deste mês acabou. Voltei para o KAZ 1.1, que continua liberado.",
  credits_unavailable: "Não deu para conferir seu crédito agora. Use o KAZ 1.1 ou tente em instantes.",
  premium_unavailable: "Esse modelo ainda não está ligado neste servidor. Use o KAZ 1.1 por enquanto.",
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
  chat_unavailable: "O armazenamento de anexos não respondeu. Tente de novo em instantes.",
  unauthenticated: "Sua sessão expirou. Entre de novo para anexar.",
  unsupported_media_type: "Tipo de arquivo não suportado.",
};

// Sem código conhecido: o status HTTP já diz o motivo (ex.: 413 da hospedagem).
function uploadError(status, data) {
  if (UPLOAD_ERRORS[data?.error]) return UPLOAD_ERRORS[data.error];
  if (status === 413) return UPLOAD_ERRORS.payload_too_large;
  if (status === 401) return UPLOAD_ERRORS.unauthenticated;
  if (status === 415) return UPLOAD_ERRORS.attachment_type;
  if (status >= 500) return "O servidor não conseguiu guardar o arquivo agora. Tente de novo.";
  return "Não deu para anexar este arquivo.";
}

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
    const when = formatReset(data.reset_at);
    return when ? `Você chegou ao limite de uso por agora. Libera ${when}.` : "Você chegou ao limite de uso por agora.";
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
  options: { effort: store.get("kazer:effort", "baixo"), web: false, memory: true, model: store.get("kazer:model", "kaz-1.1") },
  // Skills chamadas com "/" nesta mensagem.
  skillsPicked: [],
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
  // Idioma e tema primeiro, com a cópia do aparelho: a conta ainda não respondeu e
  // a tela não pode piscar em português (ou em escuro) antes de acertar.
  const local = store.get("kazer:ui", {});
  applyTheme(local.theme);
  await initLanguage(local.language);
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
    "menu", "topbar-title", "sources-top", "sources-count", "ambient", "empty", "greeting", "greeting-a", "greeting-b",
    "empty-note", "thread", "messages", "older", "to-bottom", "composer", "composer-alert",
    "composer-alert-text", "composer-alert-close", "composer-box", "tray", "skill-chips", "prompt", "plus", "model-chip",
    "open-palette",
    "forja-chip", "mic", "talk", "send", "starters", "pick-camera", "pick-photos", "pick-files",
  ];
  for (const id of ids) S.ui[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = byId(root, id);
  setSheetBackground(root);
  setAccount(email);
  // Resposta escolhida num cartão de pergunta vira a próxima mensagem.
  onAnswer((text) => {
    if (S.live) return;
    S.ui.prompt.value = text;
    autosize();
    updateSendState();
    send();
  });
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
  store.set("kazer:ui", { motion: S.prefs.motion, text_size: S.prefs.text_size, ambient: S.prefs.ambient, theme: S.prefs.theme, language: S.prefs.language });
  applyLocalPrefs();
  applyModel();
  if (S.empty) setGreeting(true);
}

// Preferências visuais aplicadas antes da resposta do servidor (sem "pulo").
function applyLocalPrefs() {
  const ui = { motion: "sistema", text_size: "m", ambient: true, theme: "escuro", language: "pt", ...store.get("kazer:ui", {}), ...pick(S.prefs, ["motion", "text_size", "ambient", "theme", "language"]) };
  setMotionPreference(ui.motion);
  applyTheme(ui.theme);
  // Idioma trocado em outro aparelho: este recarrega para falar a mesma língua.
  if (document.documentElement.lang !== (ui.language === "en" ? "en" : "pt-BR") && S.prefs?.language) {
    store.set("kazer:ui", { ...store.get("kazer:ui", {}), language: ui.language });
    window.location.reload();
    return;
  }
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
  store.set("kazer:ui", { motion: S.prefs.motion, text_size: S.prefs.text_size, ambient: S.prefs.ambient, theme: S.prefs.theme, language: S.prefs.language });
  applyLocalPrefs();
  if (S.empty) setGreeting(false);
}

// ---------- Viewport (teclado virtual e áreas seguras) ----------

function bindViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  // Altura real do composer: posiciona "ir para o fim" e os avisos logo acima dele.
  const syncComposer = () => root.style.setProperty("--composer-h", `${Math.round(S.ui.composer.offsetHeight)}px`);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(([entry]) => {
      root.style.setProperty("--composer-h", `${Math.round(entry.target.offsetHeight)}px`);
    }).observe(S.ui.composer);
  } else {
    window.addEventListener("resize", syncComposer, { passive: true });
    syncComposer();
  }
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
  paintSourcesBall();
  closeAsk({ instant: true });
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

const SCREENS = ["conversas", "forja", "artefatos", "biblioteca", "studio", "imagens"];

// Texto que cada sugestão da tela vazia coloca no campo (a pessoa completa).
const STARTERS = {
  semana: "Me ajuda a planejar minha semana com prioridades claras.",
  explicar: "Explique de um jeito simples:",
  site: "Crie um site de uma página para",
  pesquisar: "Pesquise na web e me diga:",
};

const SCREEN_LABELS = {
  conversas: "Conversas",
  forja: "KZ Code",
  artefatos: "Artefatos",
  biblioteca: "Biblioteca",
  studio: "Studio",
  imagens: "Criar imagem",
};

const SCREEN_GLYPHS = {
  conversas: "chat",
  forja: "code",
  artefatos: "layers",
  biblioteca: "book",
  studio: "layers",
  imagens: "image",
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
      onGo: (name) => showScreen(name),
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
  const last = page.items[page.items.length - 1];
  if (last?.role === "assistant" && last.status === "complete") maybeAsk(S.models.get(last.id));
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
  olderObserver = createIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadOlder();
    },
    { root: thread, rootMargin: "700px 0px 0px 0px" },
  );
  olderObserver.observe(S.ui.older);
}

function createLazyObserver() {
  return createIntersectionObserver(
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

// WebViews antigos não têm IntersectionObserver. Nesse caso, renderiza o que
// já está na tela e deixa o carregamento incremental para o botão/scroll normal.
function createIntersectionObserver(callback, options) {
  if (typeof IntersectionObserver === "function") return new IntersectionObserver(callback, options);
  return {
    observe(target) {
      callback([{ target, isIntersecting: true }]);
    },
    unobserve() {},
    disconnect() {},
  };
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
  paintSourcesBall();
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
  const images = attachments
    .filter((file) => file.kind === "image")
    .map((file) => {
      const src = file.preview || (file.id ? `/api/attachments/${file.id}` : "");
      return { url: src, legenda: file.name, fonte: src, download: file.name };
    });
  return h(
    "ul.files",
    { "aria-label": "Anexos" },
    attachments.map((file) => {
      if (file.kind === "image") {
        const src = file.preview || (file.id ? `/api/attachments/${file.id}` : "");
        const index = images.findIndex((item) => item.url === src);
        return h(
          "li.files__item.files__item--image",
          {},
          h(
            "a.files__link",
            {
              href: src,
              "aria-label": `Ver ${file.name}`,
              // Abre dentro do app (no app instalado, outra aba tiraria a pessoa do KAZER).
              onclick: (event) => {
                event.preventDefault();
                openImages(images, Math.max(index, 0));
              },
            },
            h("img.files__img", { src, alt: file.name, loading: "lazy", decoding: "async" }),
          ),
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
    h(
      "summary.think__summary",
      {},
      h("span.think__row", {}, h("span.think__label", { text: "Raciocínio" }), icon("chevron", "think__caret")),
      h("span.think__peek", { "aria-hidden": "true" }),
    ),
    h("div.think__body.md"),
  );
  const body = h("div.msg__body.md");
  const notice = h("div.msg__notice", { hidden: true });
  const actions = h("div.msg__actions", {}, actionButton("copy", "Copiar resposta", () => stripSources(model.content)));
  const made = h("div.msg__made", { hidden: true });
  const bundle = h("div.msg__bundle", { hidden: true });
  const steps = h("div.msg__steps.act", { hidden: true, role: "group", "aria-label": "O que o KAZER está fazendo" });
  const pics = h("div.msg__pics", { hidden: true });
  const el = h("article.msg.msg--kazer", { dataset: { id: model.id } }, head, steps, pics, thinking, body, bundle, made, notice, actions);
  model.el = el;
  model.parts = { head, steps, pics, thinking, body, bundle, made, notice, actions, state: head.lastChild, thinkBody: thinking.lastChild };
  model.view = new MarkdownView(body);
  // [2] no texto vira selo da fonte 2 desta resposta (só fontes que existem).
  model.view.decorate = (fragment) => {
    citeChips(fragment, model.liveSources || readSources(model.content || ""));
    // [foto N] vira a foto real da pesquisa, no meio da explicação.
    inlinePhotos(fragment, model.liveImages || readImages(model.content || ""));
  };
  applyStatus(model);
  return el;
}

// Fotos da pesquisa no topo da resposta: ao vivo (evento) ou salvas no conteúdo.
function paintPics(model) {
  const slot = model.parts?.pics;
  if (!slot) return;
  const items = model.liveImages || readImages(model.content || "");
  const key = items.map((item) => item.url).join("|");
  if (slot.dataset.key === key) return;
  slot.dataset.key = key;
  const strip = picsStrip(items);
  slot.hidden = !strip;
  slot.replaceChildren(...(strip ? [strip] : []));
}

function paintBody(model) {
  if (model.role !== "assistant") return;
  model.painted = true;
  model.view.update(model.content || "");
  paintPics(model);
  paintSteps(model);
  paintArtifacts(model);
  paintBundle(model);
  if (model.thinking) {
    model.parts.thinking.hidden = false;
    model.parts.thinkBody.replaceChildren(renderMarkdown(model.thinking));
  }
}

const STEP_ICONS = [
  [/^(Pesquisando|Procurando)/, "search"],
  [/^(Lendo|Consultando|Vendo|Cotação)/, "globe"],
  [/GitHub/, "file"],
  [/^Buscando imagens/, "image"],
  [/^Buscando/, "search"],
  [/^Calculando/, "research"],
];

function stepIcon(label) {
  return STEP_ICONS.find(([pattern]) => pattern.test(label))?.[1] || "dots";
}

// Resumo verdadeiro do que aconteceu, contado dos próprios passos.
// Resumo com números reais: páginas lidas, resultados e buscas são coisas
// diferentes e aparecem separadas (nunca "N fontes" misturando tudo).
function researchSummary(stats) {
  const parts = [];
  if (stats.paginas_lidas) parts.push(`Leu ${stats.paginas_lidas} ${stats.paginas_lidas === 1 ? "página" : "páginas"}`);
  if (stats.resultados) parts.push(`${stats.resultados} ${stats.resultados === 1 ? "resultado" : "resultados"} em ${stats.buscas} ${stats.buscas === 1 ? "busca" : "buscas"}`);
  else if (stats.buscas_tentadas) parts.push(`${stats.buscas_tentadas} ${stats.buscas_tentadas === 1 ? "busca sem resultado" : "buscas sem resultado"}`);
  if (stats.imagens) parts.push(`${stats.imagens} ${stats.imagens === 1 ? "foto" : "fotos"}`);
  return parts.join(" · ");
}

// ---------- Atividade: o que o KAZER está fazendo, no jeito do ChatGPT ----------
//
// Nada de linha do tempo com bolinhas: cada fase vira uma linha discreta. Enquanto
// acontece, o texto brilha ("Pesquisando em 12 sites", com os sites ao lado); quando
// termina, fica o resumo ("Pesquisou 16 sites") e tocar abre o que foi visto. Tudo
// sai dos passos e dos números que o servidor mandou: nada é narrado sem acontecer.

// Passos que fazem parte da pesquisa na web (viram uma linha só).
const WEB_STEP = /^(Planejando a pesquisa|Planejou a pesquisa|Pesquisando:|Lendo |Buscando imagens|Buscando artigos|Buscando no Hacker|Procurando no Stack)/;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const seconds = (ms) => Math.max(1, Math.round((ms || 0) / 1000));

function siteList(sources) {
  const hosts = [];
  for (const item of sources) {
    if (!item?.u || item.k === "imagem") continue;
    const host = siteHost(item.u);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// As linhas desta resposta, na ordem em que aconteceram.
function activityLines(model, streaming) {
  const steps = model.steps || [];
  const lines = [];
  let web = null;
  steps.forEach((step, index) => {
    if (step.kind === "write") return;
    if (step.kind === "think") {
      // Só o "pensou" logo antes de escrever vira linha; o resto é parte da pesquisa.
      // Com raciocínio do modelo, quem mostra o tempo é a caixa dele.
      if (steps[index + 1]?.kind === "write" && !model.thinking) lines.push({ key: step.id, kind: "think", step });
      return;
    }
    if (WEB_STEP.test(step.label || "")) {
      if (!web) {
        web = { key: `web-${index}`, kind: "web", steps: [] };
        lines.push(web);
      }
      web.steps.push(step);
      return;
    }
    web = null;
    lines.push({ key: step.id || `tool-${index}`, kind: "tool", step });
  });
  // Modelo que pesquisa sozinho (sem passos nossos): a linha vem do aviso dele.
  if (model.searched && !lines.some((line) => line.kind === "web")) {
    lines.unshift({ key: "native", kind: "web", steps: [], native: true });
  }
  for (const line of lines) {
    if (line.kind === "think") line.running = false;
    else if (line.native) line.running = streaming && Boolean(model.searching);
    else line.running = streaming && (line.steps || [line.step]).some((step) => step.state === "run");
  }
  // Já pesquisou e ainda não começou a escrever: o modelo está pensando de verdade.
  if (streaming && lines.length && !model.content && !model.thinking && !lines.some((line) => line.running)) {
    lines.push({ key: "pondering", kind: "pondering", running: true });
  }
  return lines;
}

function toggleActivity(model, key, running) {
  model.actOpen = model.actOpen || new Set();
  model.actLive = model.actLive || new Set();
  if (model.actOpen.has(key)) {
    model.actOpen.delete(key);
    model.actLive.delete(key);
  } else {
    model.actOpen.add(key);
    // Aberto no meio da pesquisa: fecha sozinho quando ela acaba, para a resposta aparecer.
    if (running) model.actLive.add(key);
  }
  paintSteps(model);
}

function actItem(line, model, { glyph = null, text, detail = "", panel = null, skip = null }) {
  const open = Boolean(panel) && Boolean(model.actOpen?.has(line.key));
  const inner = [
    glyph ? h("span.act__ico", { "aria-hidden": "true" }, glyph) : null,
    h("span.act__text", { text }),
    detail ? h("span.act__detail", { text: detail }) : null,
    panel ? icon("chevron", "act__caret") : null,
  ];
  const row = panel
    ? h("button.act__line", { type: "button", "aria-expanded": String(open), onclick: () => toggleActivity(model, line.key, line.running) }, inner)
    : h("div.act__line", {}, inner);
  return h(`div.act__item${line.running ? ".is-run" : ".is-done"}${open ? ".is-open" : ""}`, {}, row, skip, open ? panel : null);
}

// O que abre ao tocar: os sites (como os chips do ChatGPT), os números reais e cada passo.
function webPanel(line, sources, hosts, stats) {
  const sheet = () => openSourcesSheet(sources);
  const chips = hosts.slice(0, 3).map((host) => h("button.act__chip", { type: "button", onclick: sheet }, sourceAvatar(`https://${host}`), h("span", { text: host })));
  if (hosts.length > 3) chips.push(h("button.act__chip.act__chip--more", { type: "button", onclick: sheet }, h("span", { text: t(`mais ${hosts.length - 3}`) })));
  const facts = stats ? researchSummary(stats) : "";
  const shown = line.steps.slice(0, 10);
  const rows = shown.map((step) => {
    const glyph = /^Pesquisando:/.test(step.label) ? "search" : /^Planej/.test(step.label) ? "research" : stepIcon(step.label);
    return h("li.act__row", {}, icon(glyph), h("span", { text: step.label.replace(/^Pesquisando:\s*/, "") }), step.detail ? h("em", { text: step.detail }) : null);
  });
  if (line.steps.length > shown.length) rows.push(h("li.act__row", {}, h("span", { text: `+${line.steps.length - shown.length}` })));
  if (!chips.length && !facts && !rows.length) return null;
  return h(
    "div.act__panel",
    {},
    chips.length ? h("div.act__chips", {}, chips) : null,
    facts ? h("p.act__facts", { text: facts }) : null,
    rows.length ? h("ul.act__rows", { "aria-label": t("Passos da pesquisa") }, rows) : null,
  );
}

function webLine(line, model) {
  const sources = model.liveSources || readSources(model.content || "");
  const hosts = siteList(sources);
  const stats = model.research || readResearch(model.content || "");
  const runningNow = (pattern) => line.steps.some((step) => step.state === "run" && pattern.test(step.label));
  const photosOnly = line.steps.length > 0 && line.steps.every((step) => /^Buscando imagens/.test(step.label));
  let text;
  if (photosOnly) {
    const found = (model.liveImages || readImages(model.content || "")).length || stats?.imagens || 0;
    text = line.running ? t("Buscando imagens de referência") : found ? t(`Encontrou ${plural(found, "foto", "fotos")}`) : t("Nenhuma foto encontrada");
  } else if (line.running) {
    if (runningNow(/^Planejando/)) text = t("Planejando a pesquisa");
    else if (runningNow(/^Lendo /) && hosts.length) text = t(`Pesquisando em ${plural(hosts.length, "site", "sites")}`);
    else text = t("Pesquisando na web");
  } else {
    const count = stats?.dominios || hosts.length;
    if (stats?.pulou) text = count ? t(`Pesquisou ${plural(count, "site", "sites")} e pulou o resto`) : t("Pesquisa pulada");
    else if (count) text = t(`Pesquisou ${plural(count, "site", "sites")}`);
    else if (stats && !stats.resultados) text = t("Pesquisa sem resultados");
    else text = t("Pesquisou na web");
  }
  const faces = hosts.slice(0, 3);
  const glyph = photosOnly ? icon("image") : faces.length ? h("span.act__sites", {}, faces.map((host) => sourceAvatar(`https://${host}`))) : icon("globe");
  // "Pular" só existe enquanto há pesquisa nossa rodando (e funciona de verdade).
  const canSkip = line.running && !line.native && S.live?.replyId === model.id && line.steps.some((step) => step.state === "run" && step.skippable);
  const skip = canSkip
    ? h("button.act__skip", { type: "button", disabled: Boolean(model.skipAsked), onclick: () => skipResearch(model), text: model.skipAsked ? t("Pulando…") : t("Pular") })
    : null;
  return actItem(line, model, { glyph, text, panel: webPanel(line, sources, hosts, stats), skip });
}

function paintSteps(model) {
  const box = model.parts?.steps;
  if (!box) return;
  // Resposta carregada do histórico: os passos vêm salvos junto dela.
  if (!model.steps?.length && model.status !== "streaming" && model.content) {
    const saved = readSteps(model.content);
    if (saved.length) model.steps = saved;
  }
  const streaming = model.status === "streaming";
  if (!streaming) for (const step of model.steps || []) if (step.state === "run") step.state = "done";
  const lines = activityLines(model, streaming);
  for (const line of lines) {
    if (!line.running && model.actLive?.has(line.key)) {
      model.actLive.delete(line.key);
      model.actOpen?.delete(line.key);
    }
  }
  box.hidden = !lines.length;
  box.classList.toggle("is-live", streaming);
  box.replaceChildren(
    ...lines.map((line) => {
      if (line.kind === "web") return webLine(line, model);
      if (line.kind === "tool") return actItem(line, model, { glyph: icon(stepIcon(line.step.label)), text: line.step.label, detail: line.running ? "" : line.step.detail });
      if (line.kind === "think") return actItem(line, model, { text: t(`Pensou por ${seconds(line.step.ms)} s`) });
      const item = actItem(line, model, { text: t("Pensando") });
      ticking(item.querySelector(".act__text"), model.lastMark || model.streamStart || Date.now());
      return item;
    }),
  );
}

// Relógio do "Pensando": conta o tempo de verdade desde que começou. Só troca o
// texto (sem refazer a linha), então o brilho continua liso.
let tickTimer = 0;
function ticking(el, since) {
  if (!el) return;
  if (!since) {
    delete el.dataset.since;
    return;
  }
  // Quem chama acabou de escrever o rótulo base: o relógio entra na mesma hora
  // (sem piscar entre "Pensando" e "Pensando · 5 s" a cada redesenho).
  el.dataset.since = String(since);
  el.dataset.base = el.textContent;
  clockText(el);
  if (!tickTimer) {
    tickTimer = window.setInterval(() => {
      const live = document.querySelectorAll("[data-since]");
      if (!live.length) {
        window.clearInterval(tickTimer);
        tickTimer = 0;
        return;
      }
      for (const node of live) clockText(node);
    }, 1000);
  }
}

function clockText(node) {
  const elapsed = Math.floor((Date.now() - Number(node.dataset.since)) / 1000);
  node.textContent = elapsed >= 2 ? `${node.dataset.base} · ${elapsed} s` : node.dataset.base;
}

// A ideia mais recente do raciocínio, numa linha (sem marcação de markdown).
function lastThought(text) {
  const lines = String(text || "").split("\n").map((line) => line.replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  if (last.length <= 140) return last;
  const sentences = last.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (sentences[sentences.length - 1] || last).slice(-140);
}

// "Pular" (como no ChatGPT): encerra a pesquisa e o KAZER responde com o que já tem.
async function skipResearch(model) {
  if (S.live?.replyId !== model.id || model.skipAsked) return;
  model.skipAsked = true;
  paintSteps(model);
  const result = await request(`/api/messages/${model.id}/skip`, { body: {} });
  if (!result.ok || result.data?.status !== "skipping") {
    model.skipAsked = false;
    paintSteps(model);
    toast(t("Não deu para pular agora. A pesquisa termina sozinha em instantes."));
  }
}

// ---------- Fontes ----------

// Fontes da conversa inteira (de cada resposta, ao vivo ou já salvas).
function conversationSources() {
  const seen = new Map();
  for (const model of S.models.values()) {
    if (model.role !== "assistant") continue;
    for (const item of model.liveSources || readSources(model.content || "")) {
      if (item?.u && !seen.has(item.u)) seen.set(item.u, item);
    }
  }
  return [...seen.values()];
}

function paintSourcesBall() {
  if (!S.ui.sourcesTop) return;
  const count = conversationSources().length;
  S.ui.sourcesCount.hidden = !count;
  S.ui.sourcesCount.textContent = count > 99 ? "99+" : String(count);
  S.ui.sourcesTop.classList.toggle("has-sources", count > 0);
}

function openSourcesSheet(items = null) {
  const list = items || conversationSources();
  openSheet({
    title: "Fontes",
    opener: S.ui.sourcesTop,
    content: () =>
      list.length
        ? renderSourceList(list)
        : h(
            "div.sources-empty",
            {},
            h("span.sources-empty__icon", { "aria-hidden": "true" }, icon("globe")),
            h("p", { text: "O KAZER ainda não pesquisou nada nesta conversa." }),
            h("p.sources-empty__hint", { text: "Quando ele buscar na web, ler páginas ou consultar o GitHub, tudo aparece aqui com o link." }),
          ),
  });
}

// Pacote: com 2+ arquivos (ou um projeto Godot), um .zip com tudo.
function paintBundle(model) {
  const slot = model.parts?.bundle;
  if (!slot) return;
  const card = model.status === "streaming" ? null : bundleCard(model.content || "");
  slot.hidden = !card;
  slot.replaceChildren(...(card ? [card] : []));
}

// Entregas pedidas pela pessoa vão para "Artefatos" (gaveta) sem poluir a
// resposta: nada de lista de "peças" embaixo do texto.
function paintArtifacts(model) {
  const strip = model.parts?.made;
  if (!strip) return;
  strip.hidden = true;
  strip.replaceChildren();
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
    const busy = !model.parts.steps.hidden || Boolean(model.thinking);
    const waiting = !model.content && !model.reconnecting && !busy;
    state.textContent = model.content ? "" : model.reconnecting ? "Reconectando…" : busy ? "" : t("Pensando");
    ticking(state, waiting ? model.streamStart : 0);
  } else {
    state.textContent = "";
    ticking(state, 0);
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
  // Como no ChatGPT: "Pensando" enquanto pensa, "Pensou por N s" depois (tempo medido aqui).
  const label = model.parts.thinking.querySelector(".think__label");
  const thinkingNow = streaming && !model.content;
  model.parts.thinking.classList.toggle("is-live", thinkingNow && Boolean(model.thinking));
  if (label) label.textContent = thinkingNow ? t("Pensando") : model.thinkMs ? t(`Pensou por ${seconds(model.thinkMs)} s`) : t("Raciocínio");
  if (label) ticking(label, thinkingNow && model.thinking ? model.thinkStart : 0);
  const peek = model.parts.thinking.querySelector(".think__peek");
  if (peek) peek.textContent = thinkingNow && model.thinking ? lastThought(model.thinking) : "";
}

// ---------- Streaming ----------

let renderQueued = new Set();
let renderFrame = 0;

// O Groq escreve rápido demais: o texto chegava em blocos e "cuspia" a resposta.
// Aqui o que já chegou é mostrado aos poucos, palavra por palavra, num ritmo
// que acelera quando há muito acumulado (nunca segura o texto por muito tempo).
function revealStep(item) {
  const full = item.content || "";
  if (reducedMotion()) {
    item.shown = full.length;
    return full;
  }
  let shown = Math.min(item.shown ?? 0, full.length);
  const backlog = full.length - shown;
  if (backlog > 0) {
    let next = Math.min(full.length, shown + Math.max(2, Math.ceil(backlog / 60)));
    // Termina a palavra: nada de meia palavra piscando na tela.
    const space = full.slice(next, next + 16).search(/\s/);
    if (space > 0) next += space;
    shown = Math.min(full.length, next);
  }
  item.shown = shown;
  return full.slice(0, shown);
}

function queueRender(model) {
  renderQueued.add(model);
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    const batch = renderQueued;
    renderQueued = new Set();
    for (const item of batch) {
      if (!item.el.isConnected) {
        item.shown = (item.content || "").length;
        if (item.finishPending) finishNow(item);
        continue;
      }
      item.view.update(revealStep(item), { fade: true });
      if (item.thinking) {
        item.parts.thinking.hidden = false;
        item.parts.thinkBody.textContent = item.thinking;
      }
      applyStatus(item);
      if (item.shown < (item.content || "").length) queueRender(item);
      else if (item.finishPending) finishNow(item);
    }
    if (S.pinned) scrollToBottom(false);
  });
}

function handleEvent(model, event) {
  if (typeof event.i === "number" && S.live && S.live.replyId === model.id) S.live.lastIndex = event.i;
  if (event.type === "delta") {
    // Começou a escrever depois de pesquisar: a linha do tempo fecha com isso.
    if (model.steps?.length && !model.steps.some((step) => step.kind === "write")) {
      const gap = Date.now() - (model.lastMark || Date.now());
      if (gap >= 1500) model.steps.push({ kind: "think", ms: gap, state: "done", id: `t${model.steps.length}` });
      model.steps.push({ kind: "write", label: "Escrevendo a resposta", state: "run", id: "write" });
      paintSteps(model);
    }
    if (model.thinkStart && !model.thinkMs) model.thinkMs = Date.now() - model.thinkStart;
    model.content += event.text;
    voiceTap?.reply(model.id, model.content, false);
    const wasSearching = model.searching;
    model.searching = false;
    model.reconnecting = false;
    if (wasSearching) paintSteps(model);
    queueRender(model);
  } else if (event.type === "thinking") {
    if (!model.thinkStart) model.thinkStart = Date.now();
    model.thinking = (model.thinking || "") + event.text;
    queueRender(model);
  } else if (event.type === "searching") {
    model.searching = true;
    model.searched = true;
    paintSteps(model);
    queueRender(model);
  } else if (event.type === "title") {
    applyTitle(event.conversation_id, event.title);
  } else if (event.type === "memory") {
    // O KAZER guardou algo que a pessoa contou de si: avisa e mostra onde mexer.
    const count = event.memories?.length || 0;
    if (count) {
      toast(count === 1 ? t("Memória atualizada.") : t("Memórias atualizadas."), {
        action: { label: t("Ver"), run: () => openSettings("memoria") },
      });
    }
  } else if (event.type === "step") {
    // O KAZER conta o que está fazendo enquanto faz: o passo aparece ao começar
    // ("run") e é fechado com o que voltou ("done"). Nada é narrado sem acontecer.
    const steps = model.steps || (model.steps = []);
    const now = Date.now();
    const known = event.id ? steps.find((step) => step.id === event.id) : null;
    const next = { id: event.id || "", label: event.label, state: event.state || "done", detail: event.detail || "", skippable: Boolean(event.skippable) };
    if (known) Object.assign(known, next);
    else {
      // O tempo real entre uma ação e outra vira uma etapa "pensou por Ns".
      const gap = now - (model.lastMark || model.streamStart || now);
      if (gap >= 1500) steps.push({ kind: "think", ms: gap, state: "done", id: `t${steps.length}` });
      steps.push(next);
    }
    model.lastMark = now;
    paintSteps(model);
    applyStatus(model);
  } else if (event.type === "research") {
    model.research = event.stats;
    paintSteps(model);
  } else if (event.type === "images") {
    model.liveImages = event.items;
    paintPics(model);
  } else if (event.type === "sources") {
    model.liveSources = event.items;
    paintSteps(model);
    paintSourcesBall();
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

// ---------- Modo voz (conversa falada pelo mesmo chat) ----------

let voiceTap = null;
let voiceSheet = null;
const voiceModeModule = () => import("./voicemode.js");

const VOICE_LABELS = {
  conectando: "Conectando…",
  ouvindo: "Ouvindo",
  pensando: "Pensando",
  falando: "Falando",
  pausado: "Toque na esfera para falar",
  mudo: "Microfone desligado",
  erro: "Não deu para usar a voz",
};

const VOICE_ERRORS = {
  "not-allowed": "O microfone está bloqueado. Libere nas permissões do navegador e toque para tentar de novo.",
  "service-not-allowed": "Este navegador não liberou o reconhecimento de fala. Tente no Chrome ou no Edge.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "A voz precisa de internet. Confira a conexão e toque para tentar de novo.",
  unsupported: "Este navegador não tem reconhecimento e síntese de fala. O chat por texto continua normal.",
  overloaded: "A voz está cheia agora. Tente em instantes; o chat por texto continua normal.",
};

// Tela da conversa por voz, no jeito do ChatGPT: a esfera no centro, um status
// discreto e uma barra de botões redondos embaixo (microfone, legenda, voz,
// digitar e o X vermelho para encerrar). A legenda mostra o que foi ouvido.
function buildVoiceSheet() {
  const label = h("p.vmode__state", { "aria-live": "polite" });
  const badge = h("span", { text: "Microfone ativo" });
  const live = h("p.vmode__live");
  const canvas = h("canvas.vmode__canvas", { "aria-hidden": "true" });
  const orb = h("button.vmode__orb", { type: "button", "aria-label": "Interromper ou falar" }, canvas);
  const control = (cls, labelText, iconName) =>
    h(`button.vmode__ctl.${cls}`, { type: "button", "aria-label": labelText, title: labelText }, icon(iconName));
  const mic = control("vmode__mic", "Desligar o microfone", "mic");
  mic.setAttribute("aria-pressed", "false");
  const captions = control("vmode__cc", "Legenda", "captions");
  captions.setAttribute("aria-pressed", "true");
  const type = control("vmode__typebtn", "Voltar a digitar", "chat");
  const end = control("vmode__end", "Encerrar conversa por voz", "close");
  const root = h(
    "section.vmode",
    { role: "dialog", "aria-modal": "true", "aria-label": "Conversa por voz com o KAZER", hidden: true },
    h("header.vmode__top", {}, h("span.vmode__badge", {}, h("i.vmode__rec", { "aria-hidden": "true" }), badge)),
    h("div.vmode__stage", {}, orb, live),
    h("footer.vmode__bottom", {}, label, h("div.vmode__bar", {}, mic, captions, type, end)),
  );
  document.body.append(root);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeVoiceMode();
    }
  });
  end.addEventListener("click", () => closeVoiceMode());
  type.addEventListener("click", () => closeVoiceMode({ focusPrompt: true }));
  orb.addEventListener("click", () => voiceTap?.tap());
  mic.addEventListener("click", () => {
    const off = mic.getAttribute("aria-pressed") !== "true";
    mic.setAttribute("aria-pressed", String(off));
    mic.setAttribute("aria-label", off ? "Ligar o microfone" : "Desligar o microfone");
    mic.title = mic.getAttribute("aria-label");
    mic.replaceChildren(icon(off ? "mic-off" : "mic"));
    voiceTap?.mute(off);
    if (off) badge.textContent = "Microfone desligado";
  });
  captions.addEventListener("click", () => {
    const on = captions.getAttribute("aria-pressed") !== "true";
    captions.setAttribute("aria-pressed", String(on));
    root.classList.toggle("is-captionless", !on);
  });
  return { root, label, live, orb, badge, canvas, mic, sphere: null };
}

async function openVoiceMode() {
  if (voiceTap) return;
  if (dictation?.listening) dictation.cancel();
  const [{ createVoiceMode }, { createOrb }] = await Promise.all([voiceModeModule(), import("./voiceorb.js")]);
  voiceSheet ||= buildVoiceSheet();
  const sheet = voiceSheet;
  sheet.root.hidden = false;
  // Cada conversa por voz começa com o microfone ligado.
  sheet.mic.setAttribute("aria-pressed", "false");
  sheet.mic.setAttribute("aria-label", "Desligar o microfone");
  sheet.mic.replaceChildren(icon("mic"));
  sheet.sphere ||= createOrb(sheet.canvas, { reduced: reducedMotion });
  sheet.sphere.setState("conectando");
  sheet.sphere.start();
  document.documentElement.classList.add("is-voice-mode");
  haptic(12);
  voiceTap = createVoiceMode({
    lang: locale(),
    fetchJson: async (path, options = {}) => {
      const result = await request(path, options);
      if (!result.ok) throw new Error(result.data?.error || "failed");
      return result.data;
    },
    // O texto reconhecido vai pelo chat de sempre: fica na conversa, conta no uso.
    sendText: async (text) => {
      // Falou de novo com resposta em andamento: interrompe e manda a fala nova
      // (nada do que a pessoa disse é descartado em silêncio).
      if (S.live) {
        await stop();
        for (let i = 0; i < 50 && S.live; i += 1) await new Promise((done) => setTimeout(done, 100));
        if (S.live) {
          toast("Não deu para interromper a resposta. Tente de novo.");
          return;
        }
      }
      S.ui.prompt.value = text;
      autosize();
      updateSendState();
      // A parte síncrona do send() monta o corpo do pedido: o sinal vale só para ele.
      S.voiceSend = true;
      try {
        send();
      } finally {
        S.voiceSend = false;
      }
    },
    stopReply: () => {
      if (S.live) stop();
    },
    onState: (state, detail) => {
      sheet.root.dataset.state = state;
      sheet.sphere?.setState(state);
      // O selo diz a verdade: no motor do navegador o microfone pausa enquanto o KAZER fala.
      const micOn = state === "ouvindo" || (!["erro", "pausado", "mudo"].includes(state) && voiceTap?.engineKind === "gateway");
      sheet.badge.textContent = state === "mudo" || voiceTap?.muted ? "Microfone desligado" : micOn ? "Microfone ativo" : "Microfone em pausa";
      sheet.label.textContent = state === "erro" ? VOICE_ERRORS[detail] || VOICE_LABELS.erro : VOICE_LABELS[state] || "";
      if (state === "ouvindo") haptic(8);
    },
    // Legenda: o que a pessoa disse (cinza) e o que o KAZER está falando (branco).
    onLive: (text, speaker) => {
      if (text && text !== sheet.live.textContent) sheet.sphere?.pulse(0.35);
      sheet.live.dataset.speaker = speaker === "kazer" ? "kazer" : "voce";
      sheet.live.textContent = text;
    },
    onLevel: (value) => {
      sheet.sphere?.setLevel(value);
    },
    onError: (code) => {
      if (code === "rate_limited") toast("Muitas conversas por voz seguidas. Tente em alguns minutos.");
    },
  });
  sheet.orb.focus({ preventScroll: true });
  await voiceTap?.start({ conversationId: S.conversation?.id });
}

function closeVoiceMode({ focusPrompt = false } = {}) {
  const tap = voiceTap;
  voiceTap = null;
  tap?.close();
  if (voiceSheet) {
    voiceSheet.root.hidden = true;
    voiceSheet.live.textContent = "";
    voiceSheet.sphere?.stop();
  }
  document.documentElement.classList.remove("is-voice-mode");
  haptic(8);
  if (focusPrompt) S.ui.prompt.focus({ preventScroll: true });
  else S.ui.talk?.focus({ preventScroll: true });
}

function finishNow(model) {
  const reply = model.finishPending;
  model.finishPending = null;
  model.shown = (model.content || "").length;
  if (reply) finish(model, reply);
}

// ---------- Pergunta do KAZER (painel que sobe) ----------

const asked = new Set(); // respostas cuja pergunta já foi respondida ou dispensada

function maybeAsk(model) {
  if (!model || model.role !== "assistant" || asked.has(model.id)) return;
  // Só a última mensagem da conversa pergunta; respostas antigas não.
  const lastEl = [...S.ui.messages.children].filter((node) => node !== S.ui.older).pop();
  if (lastEl && lastEl !== model.el) return;
  const data = findQuestion(model.content);
  if (!data || !data.options.length) return;
  openAsk(model.id, data);
}

function openAsk(id, data) {
  closeAsk({ instant: true });
  const dock = questionDock(data, {
    onPick: (text) => {
      asked.add(id);
      closeAsk();
      if (S.live) return;
      S.ui.prompt.value = text;
      autosize();
      updateSendState();
      send();
    },
    onDismiss: () => {
      asked.add(id);
      closeAsk();
      S.ui.prompt.focus({ preventScroll: true });
    },
  });
  dock.dataset.reply = id;
  S.ask = dock;
  S.ui.composer.insertBefore(dock, S.ui.composerBox);
  S.ui.composerBox.classList.add("is-asking");
  announce(`O KAZER perguntou: ${data.question}`);
  if (!coarse.matches) window.requestAnimationFrame(() => dock.focusFirst());
  if (S.pinned) window.requestAnimationFrame(() => scrollToBottom(false));
}

function closeAsk({ instant = false } = {}) {
  const dock = S.ask;
  if (!dock) return;
  S.ask = null;
  S.ui.composerBox.classList.remove("is-asking");
  if (instant || reducedMotion()) {
    dock.remove();
    return;
  }
  dock.classList.add("is-leaving");
  dock.addEventListener("animationend", () => dock.remove(), { once: true });
  setTimeout(() => dock.remove(), 400);
}

function finish(model, reply) {
  const content = reply.content ?? model.content;
  // Ainda mostrando o texto aos poucos: termina de mostrar e só então entrega.
  if (model.shown !== undefined && model.shown < (content || "").length && !reducedMotion() && model.el.isConnected) {
    model.content = content;
    model.finishPending = reply;
    queueRender(model);
    return;
  }
  model.finishPending = null;
  Object.assign(model, {
    status: reply.status,
    error: reply.error,
    stop: reply.stop,
    content: reply.content ?? model.content,
    thinking: reply.thinking ?? model.thinking,
    searching: false,
    reconnecting: false,
  });
  model.liveSources = null;
  model.liveImages = null;
  model.view.update(model.content || "");
  paintPics(model);
  if (model.thinking) model.parts.thinkBody.replaceChildren(renderMarkdown(model.thinking));
  paintBundle(model);
  applyStatus(model);
  // Sem isto o último passo continuava "ao vivo" (brilhando) depois da entrega.
  paintSteps(model);
  paintSourcesBall();
  if (S.live?.replyId === model.id) {
    S.live = null;
    setStreamingUi(false);
  }
  if (S.pinned) window.requestAnimationFrame(() => scrollToBottom(false));
  announce(model.status === "complete" ? "Resposta pronta." : "A resposta não foi concluída.");
  if (model.status === "complete" && S.models.get(model.id) === model) maybeAsk(model);
  voiceTap?.reply(model.id, model.content || "", true);
  if (model.status === "error" && RETRYABLE[model.error] && !model.content) autoRetry(model);
  else if (model.status === "complete") model.busyTries = 0;
}

// Fila cheia na Groq: em vez de largar a pessoa com um erro, o KAZER tenta de
// novo sozinho (com contagem visível) — o servidor já pula os modelos lotados.
// Falhas passageiras também tentam de novo sozinhas (uma vez, rápido).
const RETRYABLE = {
  model_busy: [5, 12, 25],
  model_error: [2],
  model_empty: [2],
  model_unreachable: [3],
  model_timeout: [3],
  model_tool_failed: [2],
};

function autoRetry(model) {
  const plan = RETRYABLE[model.error] || [];
  const tries = model.busyTries || 0;
  if (tries >= plan.length) return;
  model.busyTries = tries + 1;
  let left = plan[tries];
  const busy = model.error === "model_busy";
  clearTimeout(model.busyTimer);
  const tick = () => {
    if (model.status !== "error" || S.ui.messages.lastElementChild !== model.el) return;
    if (left <= 0) {
      if (S.live || S.sending) model.busyTimer = setTimeout(tick, 1000);
      else retry(model);
      return;
    }
    const span = model.parts.notice.querySelector("span");
    if (span) span.textContent = busy ? `Muita gente usando agora. Tento de novo em ${left} s…` : `Deu um tropeço. Tentando de novo em ${left} s…`;
    left -= 1;
    model.busyTimer = setTimeout(tick, 1000);
  };
  tick();
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
  // Campo vazio (sem texto e sem anexo), sem resposta em andamento: o botão vira
  // "conversar por voz". Qualquer texto ou anexo traz a seta de enviar de volta.
  const blank = !streaming && !S.sending && !S.ui.prompt.value.trim() && !S.attachments.length;
  S.ui.composerBox.classList.toggle("is-blank", blank);
  if (S.ui.talk) {
    S.ui.talk.hidden = !blank;
    S.ui.send.hidden = blank;
  }
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
  if (S.ask) {
    asked.add(S.ask.dataset.reply);
    closeAsk();
  }
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
        model: S.options.model || "kaz-1.1",
        // Conversa por voz: o modelo mais rápido e respostas curtas e faladas.
        effort: S.voiceSend ? "baixo" : S.options.effort,
        voice: Boolean(S.voiceSend),
        skills: S.skillsPicked.map((item) => item.id),
        // Pesquisa em tempo real e memória ficam sempre ligadas (a memória
        // respeita o que a pessoa escolheu nas configurações).
        tools: { web_search: false, memory: S.prefs.memory_enabled !== false },
        forja: S.forja,
        // Projetos Godot só rodam no computador: o servidor avisa o modelo.
        desktop: desktopQuery.matches && !coarse.matches,
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
  // Modelo premium indisponível ou sem crédito: volta ao KAZ 1.1 sem travar.
  if (["credits_exhausted", "credits_unavailable", "premium_unavailable", "invalid_model"].includes(data.error)) {
    setModel("kaz-1.1", "KAZ 1.1", { quiet: true });
  }
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
  clearSkills();
  saveDraft();
  autosize();
  clearTray({ keepServer: true });
  leaveEmpty();
  if (!event.duplicate || !S.models.has(event.message.id)) {
    const message = { ...event.message };
    renderPage([message, event.reply], S.hasMore, {});
    for (const id of [event.message.id, event.reply.id]) S.models.get(id)?.el.classList.add("is-new");
    const reply = S.models.get(event.reply.id);
    if (reply) {
      reply.streamStart = Date.now();
      paintBody(reply);
    }
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
  Object.assign(model, {
    status: "streaming", content: "", thinking: "", error: null, stop: null,
    steps: [], research: null, liveSources: null, liveImages: null, searched: false, searching: false,
    skipAsked: false, actOpen: null, thinkStart: 0, thinkMs: 0, lastMark: 0, streamStart: Date.now(),
  });
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

// ---------- Skills com "/" ----------

const MAX_PICKED = 3;

function renderSkillChips() {
  const box = S.ui.skillChips;
  box.hidden = !S.skillsPicked.length;
  box.replaceChildren(
    ...S.skillsPicked.map((skill) =>
      h(
        "li.skill-chip",
        {},
        icon("sparkle", "skill-chip__glyph"),
        h("span.skill-chip__name", { text: skill.name }),
        h(
          "button.skill-chip__x",
          {
            type: "button",
            "aria-label": `Tirar a Skill ${skill.name}`,
            onclick: () => {
              S.skillsPicked = S.skillsPicked.filter((item) => item.id !== skill.id);
              renderSkillChips();
              S.ui.prompt.focus();
            },
          },
          icon("close"),
        ),
      ),
    ),
  );
}

function pickSkill(skill) {
  if (S.skillsPicked.some((item) => item.id === skill.id)) return;
  if (S.skillsPicked.length >= MAX_PICKED) {
    toast(`No máximo ${MAX_PICKED} Skills por mensagem.`);
    return;
  }
  S.skillsPicked = [...S.skillsPicked, { id: skill.id, name: skill.name, slug: skill.slug }];
  renderSkillChips();
}

function clearSkills() {
  if (!S.skillsPicked.length) return;
  S.skillsPicked = [];
  renderSkillChips();
}

// O menu só é baixado na primeira barra digitada.
function bindSlash() {
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    const { createSlash } = await import("./slash.js");
    S.slash = createSlash({
      textarea: S.ui.prompt,
      host: S.ui.composerBox,
      onPick: pickSkill,
      onBrowse: () => openSettings("skills"),
    });
    // O primeiro "/" já foi digitado: repassa o evento para o menu recém-criado.
    S.ui.prompt.dispatchEvent(new Event("input"));
  };
  S.ui.prompt.addEventListener("input", () => {
    if (!started && /(^|\s)\/[a-z0-9-]*$/i.test(S.ui.prompt.value.slice(0, S.ui.prompt.selectionStart ?? 0))) start();
  });
}

function bindComposer() {
  const { prompt, composer } = S.ui;
  bindSlash();
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
  S.ui.talk.addEventListener("click", () => openVoiceMode());
  // Sugestões da tela vazia: preenchem o campo e deixam a pessoa completar.
  S.ui.starters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-starter]");
    const text = button && STARTERS[button.dataset.starter];
    if (!text) return;
    const prompt = S.ui.prompt;
    // Frase aberta ("...para", "...diga:") ganha um espaço para a pessoa continuar.
    const value = t(text);
    prompt.value = /[.!?]$/.test(value) ? value : `${value} `;
    autosize();
    updateSendState();
    S.ui.empty.classList.add("is-typing");
    prompt.focus({ preventScroll: true });
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  });
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
// Carregado cedo: no toque, o start() precisa rodar ainda dentro do gesto da
// pessoa (é ele que faz o navegador mostrar o pedido nativo de microfone).
const voiceModule = import("./voice.js");
let voiceUi = null;
let sendAfterVoice = false;

// Ditado como o do Claude: o texto aparece ao vivo (3 linhas, as antigas somem
// no alto), a onda reage ao que o navegador ouve e a barra tem cancelar, parar
// (revisar no campo) e enviar direto.
function buildVoiceUi() {
  if (voiceUi) return voiceUi;
  const text = h("p.voice__text", { "data-placeholder": t("Pode falar…") });
  const wave = h("div.voice__wave", { "aria-hidden": "true" });
  const cancel = h("button.tool.voice__cancel", { type: "button", "aria-label": t("Cancelar ditado"), title: t("Cancelar ditado"), onclick: () => dictation?.cancel() }, icon("close"));
  const stop = h("button.tool.voice__stop", { type: "button", "aria-label": t("Parar e revisar"), title: t("Parar e revisar"), onclick: () => dictation?.stop() }, icon("stop"));
  const go = h(
    "button.send.voice__send",
    { type: "button", "aria-label": t("Enviar"), disabled: true, onclick: () => { sendAfterVoice = true; dictation?.stop(); } },
    icon("arrow-up"),
  );
  const root = h("div.voice", { role: "group", "aria-label": t("Ditado por voz") }, text, h("div.voice__bar", {}, cancel, wave, stop, go));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dictation?.cancel();
    }
  });
  S.ui.composerBox.insertBefore(root, S.ui.prompt);
  voiceUi = { root, text, wave, go, stop, bars: [], levels: [], level: 0, heard: 0, frame: 0, tick: 0 };
  return voiceUi;
}

// A onda corre da direita para a esquerda e só cresce com o que o
// reconhecimento de fala capta de verdade: cada trecho novo de texto empurra o
// nível para cima (mais texto de uma vez = mais alto) e o silêncio baixa até
// virar pontinhos. Sem segunda captura de microfone e sem volume inventado.
const WAVE_STEP_MS = 70;

function fitWave(ui) {
  const width = ui.wave.clientWidth || 160;
  const count = Math.max(8, Math.min(48, Math.floor((width + 3) / 6)));
  if (ui.bars.length === count) return;
  ui.bars = [];
  ui.levels = Array.from({ length: count }, (_, index) => ui.levels[index] || 0);
  ui.wave.replaceChildren(
    ...ui.levels.map((value) => {
      const bar = h("i");
      bar.style.setProperty("--v", value.toFixed(3));
      ui.bars.push(bar);
      return bar;
    }),
  );
}

function waveLoop(ui) {
  if (ui.frame) return;
  const step = (now) => {
    if (!S.ui.composerBox.classList.contains("is-voice")) {
      ui.frame = 0;
      return;
    }
    if (now - ui.tick >= WAVE_STEP_MS) {
      ui.tick = now;
      fitWave(ui);
      // Barra nova entra pela direita com o nível atual (com variação natural).
      const jitter = 0.55 + Math.random() * 0.45;
      ui.levels.push(ui.level > 0.04 ? Math.min(1, ui.level * jitter) : 0);
      ui.levels.shift();
      ui.level *= 0.86;
      ui.levels.forEach((value, index) => ui.bars[index]?.style.setProperty("--v", value.toFixed(3)));
      ui.wave.classList.toggle("is-hearing", ui.level > 0.04);
    }
    ui.frame = window.requestAnimationFrame(step);
  };
  ui.frame = window.requestAnimationFrame(step);
}

function voiceActivity(kind, size = 0) {
  const ui = voiceUi;
  if (!ui) return;
  if (kind === "open") {
    ui.heard = 0;
    ui.level = 0;
    ui.levels = ui.levels.map(() => 0);
    waveLoop(ui);
  } else if (kind === "sound") {
    ui.level = Math.max(ui.level, 0.3);
  } else if (kind === "word") {
    const grown = Math.max(0, size - ui.heard);
    ui.heard = size;
    // Toda atualização é sinal de fala; trechos maiores sobem mais.
    ui.level = Math.min(1, Math.max(ui.level, 0.35) + Math.min(0.6, grown / 14));
  } else if (kind === "silence") {
    ui.level *= 0.5;
  }
}

// Toque leve no aparelho (só onde existe: Android). Sem vibração em "menos movimento".
function haptic(ms) {
  if (reducedMotion()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* sem vibração */
  }
}

async function toggleDictation() {
  const { createDictation, dictationSupported, dictationError } = await voiceModule;
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
      lang: locale(),
      onLive: (text) => {
        const ui = buildVoiceUi();
        ui.text.textContent = text;
        ui.go.disabled = !text.trim();
      },
      onActivity: voiceActivity,
      onText: (text) => {
        S.ui.prompt.value = text;
        autosize();
        updateSendState();
        S.ui.empty.classList.toggle("is-typing", Boolean(text));
        if (sendAfterVoice) {
          sendAfterVoice = false;
          S.ui.composer.requestSubmit();
        }
      },
      onState: (state) => {
        const on = state !== "idle";
        S.ui.mic.setAttribute("aria-pressed", String(on));
        S.ui.mic.classList.toggle("is-listening", state === "listening");
        S.ui.mic.setAttribute("aria-label", on ? "Parar de ditar" : "Ditar por voz");
        S.ui.composerBox.classList.toggle("is-dictating", on);
        S.ui.composerBox.classList.toggle("is-voice", on);
        if (on) {
          const ui = buildVoiceUi();
          waveLoop(ui);
          if (state === "listening") {
            haptic(12);
            announce(t("Ouvindo. Pode falar."));
            ui.stop.focus({ preventScroll: true });
          }
          return;
        }
        if (voiceUi) {
          haptic(8);
          voiceUi.level = 0;
          voiceUi.heard = 0;
          voiceUi.levels = voiceUi.levels.map(() => 0);
          voiceUi.wave.classList.remove("is-hearing");
          voiceUi.text.textContent = "";
          voiceUi.go.disabled = true;
        }
        const review = !sendAfterVoice;
        sendAfterVoice = false;
        saveDraft();
        if (review && S.ui.prompt.value.trim()) S.ui.prompt.focus({ preventScroll: true });
      },
      onError: (code) => toast(dictationError(code), { duration: 6500 }),
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
  const premium = S.options.model && S.options.model !== "kaz-1.1";
  const name = premium ? store.get("kazer:model-label", "Premium") : "KAZ 1.1";
  const modelText = S.ui.modelChip.querySelector(".chip__model");
  if (modelText) modelText.textContent = name;
  const chip = S.ui.modelChip.querySelector(".chip__effort");
  if (chip) {
    chip.textContent = premium ? "" : label;
    chip.hidden = Boolean(premium);
  }
  S.ui.modelChip.setAttribute("aria-label", premium ? `Modelo ${name}` : `Modelo KAZ 1.1, esforço ${label}`);
}

function setModel(id, label, { quiet = false } = {}) {
  S.options.model = id;
  store.set("kazer:model", id);
  store.set("kazer:model-label", label);
  paintEffort();
  if (!quiet) toast(`Usando ${label}.`, { duration: 1600 });
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
  const done = (ok, data, status = 0) => {
    item.xhr = null;
    if (!S.attachments.includes(item)) return;
    // Falha passageira (rede ou servidor): tenta mais uma vez sozinho.
    if (!ok && !item.retried && (status === 0 || status >= 500) && data?.error !== "attachment_quota") {
      item.retried = true;
      item.progress = 0;
      window.setTimeout(() => upload(item, original), 900);
      return;
    }
    if (ok) {
      Object.assign(item, { status: "ready", id: data.attachment.id, kind: data.attachment.kind, name: data.attachment.name });
    } else {
      item.status = "error";
      item.error = uploadError(status, data);
      showAlert(`${item.name}: ${item.error}`);
      if (data?.error === "unauthenticated") window.dispatchEvent(new CustomEvent("kazer:unauthenticated"));
    }
    paintTrayItem(item);
    updateSendState();
  };
  xhr.addEventListener("load", () => done(xhr.status === 201, xhr.response || {}, xhr.status));
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

// ---------- Folhas: modelo, esforço e + ----------

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

// "Selecionar modelo": KAZ 1.1 (incluso) e os premium dos planos pagos.
async function openModelSheet() {
  let info = S.modelsInfo;
  try {
    const response = await fetch("/api/models", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) info = S.modelsInfo = await response.json();
  } catch {
    /* sem rede: usa o que já sabia */
  }
  const list = info?.models || [{ id: "kaz-1.1", label: "KAZ 1.1", blurb: "Incluso em todos os planos.", allowed: true, ready: Boolean(S.model?.available) }];
  const current = S.options.model || "kaz-1.1";
  openSheet({
    title: "Selecionar modelo",
    opener: S.ui.modelChip,
    content: (handle) => {
      const row = (item) => {
        const on = item.id === current;
        const locked = !item.allowed;
        const off = !locked && !item.ready;
        const badge = locked ? (item.plans?.includes("pro") ? "Pro" : "Ultra") : off ? "Em breve" : null;
        const el = h(
          `div.pick-row${locked || off ? ".is-locked" : ""}`,
          { role: "radio", "aria-checked": String(on), "aria-disabled": String(off), tabindex: "0" },
          h(
            "span.pick-row__text",
            {},
            h("span.pick-row__title", { text: item.label }),
            h("span.pick-row__desc", { text: item.maker && item.premium ? `${item.maker} · ${item.blurb}` : item.blurb }),
          ),
          badge ? h("span.pick-row__badge", { text: badge }) : on ? icon("check", "pick-row__check") : null,
        );
        return pressable(el, () => {
          if (off) return;
          handle.close();
          if (locked) {
            offerFeature({ upgrade: { id: item.plans?.[0] || "pro" } });
            return;
          }
          setModel(item.id, item.label);
        });
      };
      const base = list.filter((item) => !item.premium);
      const premium = list.filter((item) => item.premium);
      const credit = info?.credits;
      const effort = current === "kaz-1.1"
        ? h(
            "div.pick-group",
            {},
            h(
              "button.pick-row.pick-row--link",
              { type: "button", onclick: () => openEffortSheet() },
              h("span.pick-row__title", { text: "Esforço" }),
              h("span.pick-row__value", { text: effortLabel() }),
              icon("chevron-right", "pick-row__go"),
            ),
          )
        : null;
      return h(
        "div.model-sheet",
        {},
        h("div.pick-group", { role: "radiogroup", "aria-label": "Modelo" }, base.map(row)),
        premium.length ? h("p.sheet__label", { text: "Modelos premium" }) : null,
        premium.length ? h("div.pick-group", { role: "radiogroup", "aria-label": "Modelos premium" }, premium.map(row)) : null,
        credit
          ? h("p.sheet__note", { text: credit.exhausted ? "O crédito deste mês acabou. O KAZ 1.1 continua liberado." : `Crédito premium do mês: ${Math.round(credit.used_pct)}% usado.` })
          : premium.length
            ? h("p.sheet__note", { text: "Claude, GPT e Kimi entram nos planos Pro e Ultra." })
            : null,
        effort,
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
      return h("div.plus", {}, tiles);
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
  S.ui.sourcesTop.addEventListener("click", () => openSourcesSheet());
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
