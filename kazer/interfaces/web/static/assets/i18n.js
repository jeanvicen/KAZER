// Idioma da interface: português (padrão) e inglês, trocados em Configurações.
//
// Como funciona: o código do app está escrito em português e continua assim. No
// inglês, um observador de DOM traduz o que aparece na tela — texto, `placeholder`,
// `aria-label`, `title` — procurando o texto exato num dicionário (`i18n-en.js`).
// Sem tradução no dicionário, o texto fica em português: nunca some nem quebra.
//
// O que NUNCA é traduzido: o que a pessoa escreveu e o que o modelo respondeu
// (mensagens, títulos de conversa, texto de Skill, código). Essas áreas são
// puladas por seletor, e a tradução só vale para texto exato, então uma conversa
// que por acaso diga "Conversas" continua dizendo "Conversas".
//
// Em português nada disto roda e o dicionário nem é baixado. Trocar de idioma
// recarrega a página: é o jeito mais simples de garantir que tudo muda junto.

const LANGS = ["pt", "en"];
// Áreas de conteúdo (da pessoa ou do modelo) e de código: ficam como estão.
const SKIP =
  "[data-no-i18n], .msg, .markdown, .code, pre, code, textarea, input, script, style, " +
  ".hist__link, .chat__title, .sk__text, .slash__desc, .forja__session-title";

let current = "pt";
const exact = new Map();
const patterns = [];
let observer = null;

export const language = () => current;

// `{n}` no dicionário casa qualquer trecho: "{n} ferramentas" serve para "3 ferramentas".
function compile(key, value) {
  const names = [];
  const source = key
    .split(/(\{\w+\})/)
    .map((part) => {
      const slot = /^\{(\w+)\}$/.exec(part);
      if (!slot) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(slot[1]);
      return "(.+?)";
    })
    .join("");
  // Mais texto fixo = mais específico: casa antes de um molde mais frouxo.
  const fixed = key.replace(/\{\w+\}/g, "").length;
  return { re: new RegExp(`^${source}$`), names, value, fixed };
}

function lookup(text) {
  if (exact.has(text)) return exact.get(text);
  for (const { re, names, value } of patterns) {
    const found = re.exec(text);
    if (found) {
      // O que entrou no lugar do `{n}` também pode ser texto traduzível ("Baixo").
      return value.replace(/\{(\w+)\}/g, (_, name) => {
        const raw = found[names.indexOf(name) + 1] ?? "";
        return lookup(raw) ?? raw;
      });
    }
  }
  return null;
}

// Traduz uma string avulsa (para o raro texto montado em JavaScript).
export function t(text, vars) {
  const base = current === "en" ? (lookup(text) ?? text) : text;
  return vars ? base.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match)) : base;
}

function translateText(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const raw = node.nodeValue;
  const text = raw.trim();
  if (!text) return;
  const out = lookup(text);
  if (out && out !== text) node.nodeValue = raw.replace(text, out);
}

const ATTRS = ["placeholder", "aria-label", "title", "alt"];

function translateAttrs(element) {
  if (element.closest(SKIP) && !element.matches("input, textarea")) return;
  for (const name of ATTRS) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const out = lookup(value.trim());
    if (out && out !== value) element.setAttribute(name, out);
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches?.("script, style")) return;
  translateAttrs(root);
  const tree = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = tree.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else translateAttrs(node);
    node = tree.nextNode();
  }
}

function observe() {
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateText(record.target);
      else if (record.type === "attributes") translateAttrs(record.target);
      else record.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

export async function initLanguage(code) {
  current = LANGS.includes(code) ? code : "pt";
  document.documentElement.lang = current === "en" ? "en" : "pt-BR";
  if (current !== "en" || observer) return;
  const { EN } = await import("./i18n-en.js");
  for (const [key, value] of Object.entries(EN)) {
    if (/\{\w+\}/.test(key)) patterns.push(compile(key, value));
    else exact.set(key, value);
  }
  patterns.sort((a, b) => b.fixed - a.fixed);
  walk(document.body);
  observe();
}

// Locale para datas, números e ditado por voz.
export const locale = () => (current === "en" ? "en-US" : "pt-BR");
