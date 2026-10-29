// Markdown seguro para respostas do modelo: monta nós DOM com textContent,
// nunca HTML vindo de fora. Links só http(s)/mailto. Suporta títulos, listas
// (aninhadas), citações, tabelas, blocos de código com cópia e régua.
// `MarkdownView` reaproveita blocos já estáveis durante o streaming: só o
// último bloco é refeito a cada atualização, então respostas longas não travam.

import { h, icon } from "./dom.js";

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// ---------- Inline ----------

const INLINE = [
  ["code", /`([^`\n]+)`/],
  ["link", /\[([^\]\n]+)\]\(\s*(<?)([^)\s>]+)\2(?:\s+"[^"]*")?\s*\)/],
  ["auto", /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/],
  ["strong", /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/],
  ["del", /~~(?=\S)([\s\S]*?\S)~~/],
  ["em", /\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\w])_(?=\S)([^_\n]*?\S)_(?![\w])/],
];

function safeHref(url) {
  try {
    const parsed = new URL(url, "https://invalid.local");
    if (parsed.origin === "https://invalid.local") return null;
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function anchor(text, url) {
  const href = safeHref(url);
  if (!href) return document.createTextNode(text);
  return h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow", text });
}

export function inline(text, depth = 0) {
  const out = document.createDocumentFragment();
  let rest = text;
  while (rest) {
    let best = null;
    for (const [kind, pattern] of INLINE) {
      const match = pattern.exec(rest);
      if (match && (best === null || match.index < best.match.index)) best = { kind, match };
    }
    if (!best) {
      appendText(out, rest);
      break;
    }
    const { kind, match } = best;
    appendText(out, rest.slice(0, match.index));
    const inner = match[1] ?? match[2] ?? "";
    if (kind === "code") out.append(h("code", { text: match[1] }));
    else if (kind === "link") {
      const node = anchor(match[1], match[3]);
      if (node.nodeType === Node.ELEMENT_NODE) {
        node.textContent = "";
        node.append(depth < 3 ? inline(match[1], depth + 1) : match[1]);
      }
      out.append(node);
    } else if (kind === "auto") out.append(anchor(match[0], match[0]));
    else {
      const tag = { strong: "strong", del: "del", em: "em" }[kind];
      const el = document.createElement(tag);
      el.append(depth < 4 ? inline(inner, depth + 1) : inner);
      out.append(el);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

// Quebra de linha simples vira <br> (como no chat), sem interpretar HTML.
function appendText(parent, text) {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index) parent.append(document.createElement("br"));
    if (line) parent.append(line);
  });
}

// ---------- Blocos ----------

function codeBlock(lang, code) {
  const button = h("button.code__copy", { type: "button", "aria-label": "Copiar código" }, icon("copy"), h("span", { text: "Copiar" }));
  button.addEventListener("click", async () => {
    const ok = await copyText(code);
    button.classList.toggle("is-done", ok);
    button.lastChild.textContent = ok ? "Copiado" : "Falhou";
    window.setTimeout(() => {
      button.classList.remove("is-done");
      button.lastChild.textContent = "Copiar";
    }, 1600);
  });
  return h(
    "div.code",
    {},
    h("div.code__bar", {}, h("span.code__lang", { text: lang || "código" }), button),
    h("pre", { tabindex: "0" }, h("code", { text: code })),
  );
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Contexto sem clipboard assíncrono: cópia pela seleção.
    const area = h("textarea.sr-only", { readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function table(lines) {
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((cell) =>
    cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "",
  );
  const cell = (tag, text, index) => {
    const el = h(tag, {}, inline(text));
    if (aligns[index]) el.classList.add(`is-${aligns[index]}`);
    return el;
  };
  return h(
    "div.table",
    { tabindex: "0" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, head.map((text, i) => cell("th", text, i)))),
      h("tbody", {}, lines.slice(2).map((line) => h("tr", {}, splitRow(line).slice(0, head.length).map((text, i) => cell("td", text, i))))),
    ),
  );
}

function startsBlock(line, next) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_RULE.test(next) && next.includes("-"))
  );
}

function list(lines, start) {
  const first = lines[start].match(ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const el = document.createElement(ordered ? "ol" : "ul");
  if (ordered) {
    const number = parseInt(first[2], 10);
    if (number !== 1) el.start = number;
  }
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(ITEM);
    if (!match || match[1].length !== indent || /\d/.test(match[2]) !== ordered) break;
    const body = [match[3]];
    i += 1;
    // continuação: linhas mais recuadas (subitens, parágrafos do item)
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const next = lines[i + 1];
        if (next !== undefined && next.match(/^\s*/)[0].length > indent && next.trim()) {
          body.push("");
          i += 1;
          continue;
        }
        break;
      }
      const sub = line.match(ITEM);
      if (sub && sub[1].length <= indent) break;
      if (!sub && line.match(/^\s*/)[0].length <= indent && startsBlock(line, lines[i + 1])) break;
      body.push(line.replace(new RegExp(`^\\s{0,${indent + 4}}`), ""));
      i += 1;
    }
    const li = document.createElement("li");
    const task = body[0].match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      li.classList.add("is-task");
      li.append(h("span.task", { "aria-hidden": "true", text: task[1].trim() ? "✓" : "" }));
      body[0] = task[2];
    }
    const simple = body.length === 1;
    if (simple) li.append(inline(body[0]));
    else li.append(blocks(body));
    el.append(li);
  }
  return { el, next: i };
}

export function blocks(lines) {
  const out = document.createDocumentFragment();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // fechamento (ou fim do texto durante o streaming)
      out.append(codeBlock(fence[2], code.join("\n")));
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      out.append(h(`h${level}`, {}, inline(heading[2])));
      i += 1;
      continue;
    }
    if (HR.test(line)) {
      out.append(document.createElement("hr"));
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && quoted.length && !startsBlock(lines[i], lines[i + 1])))) {
        const match = lines[i].match(QUOTE);
        quoted.push(match ? match[1] : lines[i]);
        i += 1;
      }
      out.append(h("blockquote", {}, blocks(quoted)));
      continue;
    }
    if (ITEM.test(line)) {
      const { el, next } = list(lines, i);
      out.append(el);
      i = next;
      continue;
    }
    if (line.includes("|") && lines[i + 1] !== undefined && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const rows = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(lines[i]);
        i += 1;
      }
      out.append(table(rows));
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    out.append(h("p", {}, inline(paragraph.join("\n"))));
  }
  return out;
}

export function render(text) {
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"));
}

// Divide em pedaços de topo separados por linha em branco (fora de blocos de código).
function chunks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const parts = [];
  let current = [];
  let fence = null;
  for (const line of lines) {
    const match = line.match(FENCE);
    if (fence) {
      current.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (match) fence = match[1];
    if (!line.trim() && !fence) {
      if (current.length) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    // listas e citações seguem juntas mesmo com linha em branco no meio
    if (!current.length && parts.length && (ITEM.test(line) || /^\s{2,}\S/.test(line)) && ITEM.test(parts[parts.length - 1].split("\n")[0])) {
      current = parts.pop().split("\n").concat("");
    }
    current.push(line);
  }
  if (current.length) parts.push(current.join("\n"));
  return parts;
}

export class MarkdownView {
  constructor(container) {
    this.container = container;
    this.parts = []; // { source, nodes: Node[] }
  }

  update(text) {
    const next = chunks(text);
    let same = 0;
    // Pedaços idênticos e não-finais ficam como estão.
    while (same < next.length - 1 && same < this.parts.length && this.parts[same].source === next[same]) {
      same += 1;
    }
    for (const part of this.parts.slice(same)) part.nodes.forEach((node) => node.remove());
    this.parts.length = same;
    for (const source of next.slice(same)) {
      const fragment = render(source);
      const nodes = [...fragment.childNodes];
      this.container.append(fragment);
      this.parts.push({ source, nodes });
    }
  }

  clear() {
    this.container.replaceChildren();
    this.parts = [];
  }
}
