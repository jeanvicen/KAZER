// Entregas do KAZER: o que o modelo produz vira cartão de verdade.
//
// - ```kazer-pergunta {json}  → cartão com a pergunta, 3 respostas prontas e um
//   campo para a pessoa escrever a própria;
// - ```pdf nome.pdf / ```slides nome.slides → cartão de documento com prévia,
//   PDF (pela impressão do navegador) e, nos slides, o .html da apresentação;
// - arquivos com nome na cerca → baixar um a um, ou tudo num .zip;
// - páginas HTML → prévia ao vivo numa moldura isolada (/preview-frame, sem
//   acesso à sessão, aos cookies nem à API do KAZER);
// - projeto Godot (project.godot) → pacote .zip, só no computador.
//
// Tudo é montado com textContent; nada do modelo vira HTML desta página. O HTML
// gerado (prévias, PDFs, slides) só existe dentro da moldura isolada.

import { formatBytes, h, icon, mark, reducedMotion } from "./dom.js";

// ---------- Pergunta ----------

let answer = null;
// O chat registra como uma resposta escolhida vira mensagem enviada.
export function onAnswer(handler) {
  answer = handler;
}

function parseQuestion(code) {
  try {
    const data = JSON.parse(code);
    const question = String(data.pergunta || data.question || "").trim();
    const options = (Array.isArray(data.opcoes) ? data.opcoes : Array.isArray(data.options) ? data.options : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return question ? { question, options } : null;
  } catch {
    return null;
  }
}

function questionCard(code, closed) {
  const data = closed ? parseQuestion(code) : null;
  if (!data) {
    return h(
      "div.ask.is-loading",
      { "aria-live": "polite" },
      h("div.ask__head", {}, mark("ask__mark"), h("span", { text: "Preparando uma pergunta…" })),
    );
  }
  const card = h("div.ask", { role: "group", "aria-label": "Pergunta do KAZER" });
  const buttons = [];
  const settle = (text, chosen) => {
    card.classList.add("is-answered");
    for (const button of buttons) button.disabled = true;
    chosen?.classList.add("is-chosen");
    own.input.disabled = true;
    own.send.disabled = true;
    answer?.(text);
  };
  const options = data.options.map((text, index) => {
    const button = h(
      "button.ask__option",
      { type: "button", onclick: () => settle(text, button) },
      h("span.ask__key", { text: String(index + 1) }),
      h("span.ask__text", { text }),
      icon("chevron-right", "ask__go"),
    );
    button.style.setProperty("--i", String(index));
    buttons.push(button);
    return button;
  });
  const input = h("input.ask__input", {
    type: "text",
    maxlength: "2000",
    placeholder: "Ou escreva a sua resposta…",
    "aria-label": "Sua resposta",
    autocomplete: "off",
  });
  const send = h("button.ask__send", { type: "submit", "aria-label": "Enviar resposta", disabled: true }, icon("arrow-up"));
  input.addEventListener("input", () => {
    send.disabled = !input.value.trim();
  });
  const form = h("form.ask__own", {}, input, send);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) settle(text, null);
  });
  const own = { input, send };
  card.append(
    h("div.ask__head", {}, mark("ask__mark"), h("span", { text: "Pergunta" })),
    h("p.ask__question", { text: data.question }),
    h("div.ask__options", {}, options),
    form,
  );
  return card;
}

// ---------- Documentos (PDF e slides) ----------

export function frontMatter(code) {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  const meta = {};
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (lines[start]?.trim() === "---") {
    let end = start + 1;
    while (end < lines.length && lines[end].trim() !== "---") {
      const match = lines[end].match(/^\s*([\wÀ-ú]+)\s*:\s*(.*)$/);
      if (match) meta[match[1].toLowerCase()] = match[2].trim();
      end += 1;
    }
    if (end < lines.length) return { meta, body: lines.slice(end + 1).join("\n") };
  }
  return { meta, body: code };
}

export function splitSlides(body) {
  const slides = [];
  let current = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^\s*---\s*$/.test(line)) {
      if (current.join("").trim()) slides.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.join("").trim()) slides.push(current.join("\n"));
  return slides;
}

const docTitle = (meta, name, fallback) =>
  meta.titulo || meta.title || (name ? name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") : fallback);

function docCard(kind, name, code, closed) {
  const pdf = kind === "pdf";
  const label = pdf ? "Documento PDF" : "Apresentação";
  if (!closed) {
    return h(
      `div.doc-card.doc-card--${kind}.is-loading`,
      { "aria-live": "polite" },
      h("div.doc-card__thumb", { "aria-hidden": "true" }, h("span.doc-card__shine")),
      h(
        "div.doc-card__info",
        {},
        h("span.doc-card__kind", { text: label }),
        h("strong.doc-card__title", { text: pdf ? "Escrevendo o documento…" : "Montando os slides…" }),
      ),
    );
  }
  const { meta, body } = frontMatter(code);
  const title = docTitle(meta, name, label);
  const slides = pdf ? null : splitSlides(body);
  const words = body.split(/\s+/).filter(Boolean).length;
  const detail = pdf ? `~${Math.max(1, Math.round(words / 380) + 1)} páginas` : `${slides.length + 1} slides`;
  const file = name || (pdf ? "documento.pdf" : "apresentacao.slides");

  const run = async (action) => {
    const docs = await import("./docs.js");
    const html = pdf ? docs.buildPdf(meta, body) : docs.buildSlides(meta, slides);
    const base = file.replace(/\.[^.]+$/, "") || "kazer";
    if (action === "html") downloadText(`${base}.html`, html);
    else openPreview({ title, html, print: action === "pdf", printable: true, file: `${base}.html` });
  };

  const thumb = h(
    "div.doc-card__thumb",
    { "aria-hidden": "true" },
    pdf
      ? h("span.doc-card__page", {}, h("span.doc-card__band"), h("span.doc-card__lines"))
      : h("span.doc-card__deck", {}, h("span"), h("span"), h("span")),
  );
  const accent = /^#[0-9a-f]{3,8}$/i.test(meta.cor || "") ? meta.cor : pdf ? "#2563eb" : "#e8b04a";
  thumb.style.setProperty("--accent", accent);
  return h(
    `div.doc-card.doc-card--${kind}`,
    {},
    thumb,
    h(
      "div.doc-card__info",
      {},
      h("span.doc-card__kind", { text: `${label} · ${detail}` }),
      h("strong.doc-card__title", { text: title }),
      meta.subtitulo ? h("span.doc-card__sub", { text: meta.subtitulo }) : null,
      h(
        "div.doc-card__actions",
        {},
        h("button.doc-card__btn.is-primary", { type: "button", onclick: () => run("view") }, icon(pdf ? "file" : "research"), h("span", { text: pdf ? "Abrir" : "Apresentar" })),
        h("button.doc-card__btn", { type: "button", onclick: () => run("pdf") }, icon("down"), h("span", { text: "Baixar PDF" })),
        pdf ? null : h("button.doc-card__btn", { type: "button", onclick: () => run("html") }, icon("down"), h("span", { text: "HTML" })),
      ),
    ),
  );
}

export function fenceHook({ lang, name, code, closed }) {
  const kind = (lang || "").toLowerCase();
  if (kind === "kazer-pergunta") return questionCard(code, closed);
  if (kind === "pdf" || kind === "slides") return docCard(kind, name, code, closed);
  return null;
}

// ---------- Arquivos ----------

const MIME = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  md: "text/markdown",
  csv: "text/csv",
  xml: "application/xml",
};

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name.split("/").pop() || "arquivo", hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadText(name, text) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  downloadBlob(name, new Blob([text], { type: `${MIME[ext] || "text/plain"};charset=utf-8` }));
}

export function isPreviewable(lang, name) {
  return /\.html?$/i.test(name || "") || (!name && /^html?$/i.test(lang || ""));
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]*)[ \t]*(.*)$/;
const PATH = /^[^\s\\<>:"|?*]{1,180}\.[A-Za-z0-9]{1,12}$|^[^\s\\<>:"|?*]*project\.godot$/;

// Arquivos com nome entregues numa resposta (para o pacote .zip).
export function collectFiles(text) {
  const files = [];
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(FENCE_LINE);
    if (!match) continue;
    const marker = match[1];
    const body = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trimStart().startsWith(marker)) {
      body.push(lines[j]);
      j += 1;
    }
    const closed = j < lines.length;
    const path = (match[3] || "").trim().replace(/^\.?\//, "");
    const lang = (match[2] || "").toLowerCase();
    if (closed && PATH.test(path) && !path.split("/").includes("..") && !["pdf", "slides", "kazer-pergunta"].includes(lang)) {
      const index = files.findIndex((file) => file.path === path);
      const file = { path, lang, code: body.join("\n") + "\n" };
      if (index >= 0) files[index] = file; // versão mais nova vence
      else files.push(file);
    }
    i = j;
  }
  return files;
}

function bundleName(files, godot) {
  const roots = new Set(files.map((file) => (file.path.includes("/") ? file.path.split("/")[0] : "")));
  if (roots.size === 1 && !roots.has("")) return `${[...roots][0]}.zip`;
  return godot ? "projeto-godot.zip" : "kazer-arquivos.zip";
}

const isDesktop = () => window.matchMedia("(min-width: 60rem)").matches && !window.matchMedia("(pointer: coarse)").matches;

// Cartão do pacote: aparece com 2+ arquivos ou num projeto Godot.
export function bundleCard(text) {
  const files = collectFiles(text);
  const godot = files.some((file) => /(^|\/)project\.godot$/.test(file.path));
  if (files.length < 2 && !godot) return null;
  const size = files.reduce((total, file) => total + new Blob([file.code]).size, 0);
  const name = bundleName(files, godot);
  const desktop = isDesktop();
  const blocked = godot && !desktop;

  const download = h(
    "button.bundle__cta",
    {
      type: "button",
      disabled: blocked,
      onclick: async () => {
        const { zip } = await import("./zip.js");
        downloadBlob(name, zip(files.map((file) => ({ name: file.path, data: file.code }))));
      },
    },
    icon("down"),
    h("span", { text: blocked ? "Disponível no computador" : `Baixar ${name}` }),
  );
  const shown = files.slice(0, 8);
  const rest = files.length - shown.length;
  return h(
    `div.bundle${godot ? ".bundle--godot" : ""}`,
    {},
    h(
      "div.bundle__head",
      {},
      h("span.bundle__icon", { "aria-hidden": "true" }, icon(godot ? "research" : "file")),
      h(
        "div.bundle__text",
        {},
        h("strong", { text: godot ? "Projeto Godot 4" : `${files.length} arquivos` }),
        h("span", { text: `${files.length} arquivos · ${formatBytes(size)}` }),
      ),
    ),
    h(
      "ul.bundle__files",
      {},
      shown.map((file) => h("li", {}, icon("file"), h("span", { text: file.path }))),
      rest > 0 ? h("li.bundle__more", { text: `+${rest} arquivos` }) : null,
    ),
    godot
      ? h(
          "ol.bundle__steps",
          {},
          desktop
            ? [
                h("li", { text: "Baixe e extraia o .zip." }),
                h("li", { text: "Abra o Godot 4 → Importar → escolha o project.godot." }),
                h("li", { text: "Aperte F5 para jogar." }),
              ]
            : h("li", { text: "Projetos Godot rodam no computador. Abra o KAZER no PC para baixar." }),
        )
      : null,
    download,
  );
}

// ---------- Prévia isolada ----------

let preview = null;

export function openPreview({ title, html, print = false, printable = false, file = "" }) {
  preview?.close();
  const frame = h("iframe.preview__frame", {
    title: `Prévia: ${title}`,
    src: "/preview-frame",
    // Sem allow-same-origin: a página roda numa origem opaca, sem cookies,
    // sem sessão e sem acesso à API do KAZER.
    sandbox: "allow-scripts allow-modals allow-popups allow-downloads allow-pointer-lock allow-forms",
    allow: "fullscreen",
    referrerpolicy: "no-referrer",
  });
  let ready = false;
  const post = (message) => frame.contentWindow?.postMessage(message, "*");
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || event.data?.kazerPreview !== "ready" || ready) return;
    ready = true;
    post({ kazerHtml: html });
    root.classList.add("is-ready");
    if (print) window.setTimeout(() => post({ kazerPrint: true }), 900);
  };
  window.addEventListener("message", onMessage);

  const widths = h(
    "div.preview__sizes",
    { role: "radiogroup", "aria-label": "Largura da prévia" },
    [
      ["", "Cheia"],
      ["390px", "Celular"],
    ].map(([width, label], index) =>
      h("button.preview__size", {
        type: "button",
        role: "radio",
        "aria-checked": String(index === 0),
        text: label,
        onclick: (event) => {
          for (const item of widths.children) item.setAttribute("aria-checked", String(item === event.currentTarget));
          stage.style.setProperty("--w", width || "100%");
        },
      }),
    ),
  );
  const stage = h("div.preview__stage", {}, frame, h("div.preview__wait", { "aria-hidden": "true" }, mark("preview__mark")));
  const close = () => {
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey, true);
    root.classList.remove("is-open");
    window.setTimeout(() => root.remove(), reducedMotion() ? 0 : 240);
    preview = null;
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  const root = h(
    "div.preview",
    { role: "dialog", "aria-modal": "true", "aria-label": `Prévia de ${title}` },
    h(
      "div.preview__bar",
      {},
      h("div.preview__title", {}, h("span.preview__dot", { "aria-hidden": "true" }), h("span", { text: title })),
      widths,
      h(
        "div.preview__tools",
        {},
        printable
          ? h("button.preview__btn", { type: "button", onclick: () => post({ kazerPrint: true }) }, icon("down"), h("span", { text: "PDF" }))
          : null,
        h(
          "button.preview__btn",
          { type: "button", onclick: () => downloadText(file || (/\.html?$/i.test(title) ? title : `${title}.html`), html) },
          icon("down"),
          h("span", { text: "HTML" }),
        ),
        h("button.preview__btn.preview__close", { type: "button", "aria-label": "Fechar prévia", onclick: close }, icon("close")),
      ),
    ),
    stage,
  );
  document.addEventListener("keydown", onKey, true);
  document.body.append(root);
  window.requestAnimationFrame(() => root.classList.add("is-open"));
  preview = { close };
  return preview;
}
