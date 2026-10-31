// Utilitários de interface sem innerHTML: todo texto vindo do usuário ou do
// modelo entra por textContent. Ícones são traços simples desenhados aqui.

const SVG = "http://www.w3.org/2000/svg";

// Elemento HTML: h("button.chip#id", { type: "button", onclick }, filhos...)
export function h(spec, props = {}, ...children) {
  const [, tag = "div", rest = ""] = spec.match(/^([a-z0-9-]+)?(.*)$/i);
  const el = document.createElement(tag);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "text") el.textContent = value;
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

// Traços 24×24 (linhas arredondadas), desenhados para este projeto.
const PATHS = {
  menu: ["M4 7h16", "M4 12h10", "M4 17h16"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  "arrow-up": ["M12 19V5", "M6 11l6-6 6 6"],
  stop: ["M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z"],
  camera: ["M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z", "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  image: ["M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z", "M4 16l4.5-4.5 4 4 2.5-2.5L20 18", "M15.5 9.5h.01"],
  file: ["M7 3.5h6.5L18 8v12.5H7z", "M13 3.5V8h5", "M9.5 12.5h6", "M9.5 16h6"],
  search: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M15.5 15.5L20 20"],
  globe: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z", "M3.5 12h17", "M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z"],
  plug: ["M9 3.5V8", "M15 3.5V8", "M6.5 8h11v3a5.5 5.5 0 0 1-11 0z", "M12 16.5v4"],
  memory: ["M8 4.5h8a1.5 1.5 0 0 1 1.5 1.5v14l-5.5-3.5L6.5 20V6A1.5 1.5 0 0 1 8 4.5z"],
  research: ["M5 19.5V9", "M10 19.5V4.5", "M15 19.5V12", "M20 19.5v-6"],
  chevron: ["M8 10l4 4 4-4"],
  "chevron-right": ["M10 7l5 5-5 5"],
  back: ["M15 5l-7 7 7 7"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  copy: ["M8.5 8.5h10v11h-10z", "M15.5 8.5V4.5h-10v11h3"],
  retry: ["M5 12a7 7 0 1 0 2.05-4.95", "M5 4.5v3.5h3.5"],
  trash: ["M5 7h14", "M9.5 7V4.5h5V7", "M7 7l1 13h8l1-13"],
  edit: ["M5 19l1-4L16 5l3 3L9 18z", "M14 7l3 3"],
  gear: ["M18.69 9.93 L21.07 10.44 L21.07 13.56 L18.69 14.07 L18.19 15.27 L19.51 17.31 L17.31 19.51 L15.27 18.19 L14.07 18.69 L13.56 21.07 L10.44 21.07 L9.93 18.69 L8.73 18.19 L6.69 19.51 L4.49 17.31 L5.81 15.27 L5.31 14.07 L2.93 13.56 L2.93 10.44 L5.31 9.93 L5.81 8.73 L4.49 6.69 L6.69 4.49 L8.73 5.81 L9.93 5.31 L10.44 2.93 L13.56 2.93 L14.07 5.31 L15.27 5.81 L17.31 4.49 L19.51 6.69 L18.19 8.73Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  "sign-out": ["M14 4.5H6.5v15H14", "M10.5 12H20", "M16.5 8.5L20 12l-3.5 3.5"],
  compose: ["M12.5 4.5h-7v14h14v-7", "M10 14l.6-2.6L18 4l2 2-7.4 7.4z"],
  down: ["M12 5v14", "M6 13l6 6 6-6"],
  dots: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20a7.5 7.5 0 0 1 15 0"],
  sliders: ["M5 7h9", "M18 7h1", "M16 5v4", "M5 17h3", "M12 17h7", "M10 15v4", "M5 12h12", "M19 12h0"],
  shield: ["M12 3.5l7 2.5v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z"],
  info: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z", "M12 11v5.5", "M12 7.5h.01"],
  download: ["M12 4.5v11", "M7 11l5 5 5-5", "M5 19.5h14"],
  wifi: ["M3.5 9a12 12 0 0 1 17 0", "M6.5 12.5a7.5 7.5 0 0 1 11 0", "M9.5 16a3 3 0 0 1 5 0", "M12 19.5h.01"],
  key: ["M14.5 13.5a4.5 4.5 0 1 0-4.1-6.3", "M10.6 9.5L3.5 16.6v3h3v-2h2v-2h2l1.5-1.5"],
  devices: ["M3.5 6.5h12v9h-12z", "M7 19h5", "M17.5 9.5h3v10h-3z"],
  mic: ["M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6.5a3.5 3.5 0 1 0-7 0V12a3.5 3.5 0 0 0 3.5 3.5z", "M5.5 11.5a6.5 6.5 0 0 0 13 0", "M12 18.5v3"],
  lock: ["M8 10.5V8a4 4 0 0 1 8 0v2.5", "M6 10.5h12v9.5H6z", "M12 14.5v2"],
  sparkle: ["M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8z", "M18.5 16v4", "M16.5 18h4"],
  bolt: ["M13 3.5L6 13.5h5l-1 7 7-10h-5z"],
  crown: ["M4 17.5h16", "M4.5 7.5l3.5 4 4-6 4 6 3.5-4-1.5 7h-12z"],
  book: ["M5 5a1.5 1.5 0 0 1 1.5-1.5H18v17H6.5A1.5 1.5 0 0 1 5 19z", "M5 16.5h13"],
  chat: ["M12 19.5c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7c0 2 .9 3.8 2.4 5.1L6 20.5l3.4-1.4c.8.3 1.7.4 2.6.4z"],
  code: ["M9 8l-4 4 4 4", "M15 8l4 4-4 4"],
  branch: ["M7 4.5v10.5", "M7 19.5a1.8 1.8 0 1 0 0-.01", "M17 8a1.8 1.8 0 1 0 0-.01", "M17 9.8c0 3.6-3.4 4.4-10 5.2"],
  terminal: ["M3.5 5.5h17v13h-17z", "M7 10l2 2-2 2", "M11.5 14.5h5"],
  layers: ["M6.5 7.5h8v11h-8z", "M10 5.5h8v11", "M9 11.5h3.5", "M9 14.5h3.5"],
};

export function icon(name, cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon ${cls}`.trim());
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// O símbolo Fenda (mesmas metades do logo), para marcas pequenas na interface.
export function mark(cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `mark ${cls}`.trim());
  for (const [klass, points] of [
    ["mark__l", "30,1.14 10,27.5 30,53.86"],
    ["mark__r", "34,10.14 54,36.5 34,62.86"],
  ]) {
    const polygon = document.createElementNS(SVG, "polygon");
    polygon.setAttribute("class", klass);
    polygon.setAttribute("points", points);
    svg.append(polygon);
  }
  return svg;
}

// Troca <span data-icon="nome"> por SVG (marcação dos templates).
export function hydrateIcons(root) {
  for (const slot of root.querySelectorAll("[data-icon]")) {
    slot.replaceWith(icon(slot.dataset.icon, slot.className));
  }
  for (const slot of root.querySelectorAll("[data-mark]")) {
    slot.replaceWith(mark(slot.className));
  }
}

// Folha de estilo carregada só quando a tela que precisa dela abre: o celular
// não baixa o CSS de telas que ninguém usou ainda.
const styles = new Map();

export function loadStyle(href) {
  const cached = styles.get(href);
  if (cached) return cached;
  const promise = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    // Um erro aqui não pode travar a tela: ela abre sem o estilo extra.
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  });
  styles.set(href, promise);
  return promise;
}

export function byId(root, id) {
  return root.querySelector(`#${id}`);
}

// ---------- Movimento ----------

const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPref = "sistema";

export function setMotionPreference(value) {
  motionPref = value;
  document.documentElement.dataset.motion = value;
}

export function reducedMotion() {
  if (motionPref === "reduzido") return true;
  if (motionPref === "completo") return false;
  return systemReduced.matches;
}

export const finePointer = () => window.matchMedia("(pointer: fine)").matches;

// ---------- Formatação ----------

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// Datas seguem o idioma escolhido (`<html lang>`), lido na hora de formatar.
const lang = () => document.documentElement.lang || "pt-BR";
const timeFmt = { format: (d) => new Intl.DateTimeFormat(lang(), { hour: "2-digit", minute: "2-digit" }).format(d) };
const dateFmt = { format: (d) => new Intl.DateTimeFormat(lang(), { day: "numeric", month: "long", year: "numeric" }).format(d) };
const dayFmt = { format: (d) => new Intl.DateTimeFormat(lang(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(d) };

export function formatTime(seconds) {
  return timeFmt.format(new Date(seconds * 1000));
}

export function formatDate(seconds) {
  return dateFmt.format(new Date(seconds * 1000));
}

// "às 14:32", "amanhã às 08:10" ou "quinta-feira, 08:10".
export function formatReset(seconds) {
  const target = new Date(seconds * 1000);
  const now = new Date();
  const days = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);
  if (days <= 0) return `às ${timeFmt.format(target)}`;
  if (days === 1) return `amanhã às ${timeFmt.format(target)}`;
  return dayFmt.format(target);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Grupo do histórico pela data local de atualização.
export function dayGroup(seconds) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(seconds * 1000))) / 86400000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return "Últimos 7 dias";
  if (days < 30) return "Últimos 30 dias";
  return "Mais antigas";
}

// ---------- Foco ----------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.offsetParent !== null);
}

// Mantém Tab/Shift+Tab dentro de um diálogo aberto.
export function trapFocus(root, event) {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Leitor de tela: uma região educada para avisos curtos.
let liveRegion = null;
export function announce(text) {
  if (!liveRegion) {
    liveRegion = h("div.sr-only", { role: "status", "aria-live": "polite" });
    document.body.append(liveRegion);
  }
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = text;
  }, 60);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Armazenamento local tolerante a falhas (aba privada, cota cheia).
export const store = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sem armazenamento: segue sem lembrar */
    }
  },
};

export const session = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === "") window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      /* ignorado */
    }
  },
  take(key) {
    const value = this.get(key);
    this.set(key, null);
    return value;
  },
  clearPrefix(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) keys.push(window.sessionStorage.key(i));
      for (const key of keys) if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
    } catch {
      /* ignorado */
    }
  },
};
