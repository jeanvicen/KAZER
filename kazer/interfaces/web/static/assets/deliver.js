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
import { openSheet } from "./sheets.js";

// ---------- Pergunta ----------

let answer = null;
// O chat registra como uma resposta escolhida vira mensagem enviada.
export function onAnswer(handler) {
  answer = handler;
}

// Tolerante: o modelo às vezes manda aspas tortas, vírgula sobrando ou outros
// nomes de campo. Só precisa de um objeto JSON completo (durante a escrita,
// ainda incompleto, o cartão fica em "Preparando").
export function parseQuestion(code) {
  const raw = String(code || "");
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const json = raw
    .slice(first, last + 1)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const question = String(data.pergunta || data.question || data.titulo || "").trim();
  const list = [data.opcoes, data["opções"], data.options, data.respostas, data.alternativas].find(Array.isArray) || [];
  const items = list
    .map((item) => {
      if (item && typeof item === "object") {
        return {
          text: String(item.texto || item.text || item.label || item.titulo || "").trim(),
          hint: String(item.descricao || item["descrição"] || item.description || item.detalhe || "").trim(),
        };
      }
      return { text: String(item || "").trim(), hint: "" };
    })
    .filter((item) => item.text)
    .slice(0, 4);
  if (!question) return null;
  return { question, options: items.map((item) => item.text), hints: items.map((item) => item.hint) };
}

// A última pergunta de uma resposta (bloco ```kazer-pergunta fechado).
export function findQuestion(content) {
  const blocks = [...String(content || "").matchAll(/```kazer-pergunta[^\n]*\n([\s\S]*?)```/g)];
  return blocks.length ? parseQuestion(blocks[blocks.length - 1][1]) : null;
}

// Bloco fechado que nem o leitor tolerante entende: mostra o texto legível,
// nunca um "Preparando…" eterno.
function questionFallback(code) {
  const text = String(code || "")
    .replace(/[{}\[\]"]/g, " ")
    .replace(/\b(pergunta|question|opcoes|opções|options)\s*:/gi, "\n")
    .replace(/\s*,\s*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!text.length) return h("span", { hidden: true });
  return h("div.ask", { role: "group" }, h("p.ask__question", { text: text[0] }), ...text.slice(1, 4).map((line) => h("p.ask__hint", { text: `• ${line}` })));
}

// Na conversa fica só o registro da pergunta; quem responde é o painel que
// sobe em cima do campo de escrita (questionDock).
function questionCard(code, closed) {
  const data = parseQuestion(code);
  if (!data && closed) return questionFallback(code);
  if (!data) {
    return h(
      "div.ask.is-loading",
      { "aria-live": "polite" },
      h("div.ask__head", {}, mark("ask__mark"), h("span", { text: "Preparando uma pergunta…" })),
    );
  }
  return h(
    "div.ask.is-note",
    { role: "note", "aria-label": "Pergunta do KAZER" },
    h("div.ask__head", {}, mark("ask__mark"), h("span", { text: "Pergunta" })),
    h("p.ask__question", { text: data.question }),
    h("ol.ask__list", {}, data.options.map((text) => h("li", { text }))),
  );
}

// Painel da pergunta: sobe do campo de escrita como o do Claude. Números
// escolhem, setas andam, Esc dispensa (a pessoa escreve o que quiser no campo).
export function questionDock(data, { onPick, onDismiss }) {
  const dock = h("section.askdock", { role: "dialog", "aria-modal": "false", "aria-label": "Pergunta do KAZER" });
  const close = h("button.askdock__close", { type: "button", "aria-label": "Dispensar pergunta", onclick: () => onDismiss?.() }, icon("close"));
  const head = h(
    "div.askdock__head",
    {},
    h("span.askdock__chip", {}, mark("askdock__mark"), h("span", { text: "KAZER quer saber" })),
    close,
  );
  const options = data.options.map((text, index) => {
    const hint = data.hints?.[index];
    const button = h(
      "button.askdock__option",
      { type: "button", onclick: () => onPick?.(text) },
      h("span.askdock__key", { text: String(index + 1) }),
      h("span.askdock__body", {}, h("span.askdock__label", { text }), hint ? h("span.askdock__hint", { text: hint }) : null),
      icon("chevron-right", "askdock__go"),
    );
    button.style.setProperty("--i", String(index));
    return button;
  });
  const input = h("input.askdock__input", {
    type: "text",
    maxlength: "2000",
    placeholder: "Outra coisa… escreva aqui",
    "aria-label": "Sua resposta",
    autocomplete: "off",
    enterkeyhint: "send",
  });
  const send = h("button.askdock__send", { type: "submit", "aria-label": "Enviar resposta", disabled: true }, icon("arrow-up"));
  input.addEventListener("input", () => {
    send.disabled = !input.value.trim();
  });
  const form = h("form.askdock__own", {}, h("span.askdock__key.is-own", { text: String(options.length + 1) }), input, send);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = input.value.trim();
    if (text) onPick?.(text);
  });
  form.style.setProperty("--i", String(options.length));
  dock.append(
    head,
    h("p.askdock__question", { text: data.question }),
    h("div.askdock__options", {}, options),
    form,
    h("p.askdock__keys", { text: "1–" + (options.length + 1) + " escolhe · Esc dispensa" }),
  );
  dock.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss?.();
      return;
    }
    const typing = event.target === input;
    if (!typing && /^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (options[index]) {
        event.preventDefault();
        options[index].click();
      } else if (index === options.length) {
        event.preventDefault();
        input.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = [...options, input];
      const at = items.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      next.focus();
    }
  });
  dock.focusFirst = () => (options[0] || input).focus({ preventScroll: true });
  return dock;
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

  const base = file.replace(/\.[^.]+$/, "") || "kazer";
  const run = async (action, button) => {
    if (action === "pdf") {
      // O servidor desenha o PDF de verdade; a pessoa só baixa o arquivo.
      const label = button?.querySelector("span");
      if (label) label.textContent = "Gerando…";
      if (button) button.disabled = true;
      try {
        const response = await fetch("/api/documents/render", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, source: code, name: `${base}.pdf` }),
        });
        if (!response.ok) throw new Error(String(response.status));
        downloadBlob(`${base}.pdf`, await response.blob());
        return;
      } catch {
        // Sem servidor: a impressão do navegador ainda salva como PDF.
      } finally {
        if (label) label.textContent = "Baixar PDF";
        if (button) button.disabled = false;
      }
    }
    const docs = await import("./docs.js");
    const html = pdf ? docs.buildPdf(meta, body) : docs.buildSlides(meta, slides);
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
  const accent = /^#[0-9a-f]{3,8}$/i.test(meta.cor || "") ? meta.cor : pdf ? "#2563eb" : "#d5b15a";
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
        h("button.doc-card__btn", { type: "button", onclick: (event) => run("pdf", event.currentTarget) }, icon("down"), h("span", { text: "Baixar PDF" })),
        pdf ? null : h("button.doc-card__btn", { type: "button", onclick: () => run("html") }, icon("down"), h("span", { text: "HTML" })),
      ),
    ),
  );
}

export function fenceHook({ lang, name, code, closed }) {
  const kind = (lang || "").toLowerCase();
  if (kind === "kazer-pergunta") return questionCard(code, closed);
  if (kind === "pdf" || kind === "slides") return docCard(kind, name, code, closed);
  if (kind === "kazer-fontes") return sourcesStrip(code, closed);
  if (kind === "kazer-passos" || kind === "kazer-imagens" || kind === "kazer-pesquisa") return h("span", { hidden: true });
  if (kind === "kazer-galeria") return galleryCard(code, closed);
  if (kind === "mermaid") return diagramCard(code, closed);
  return null;
}

// ---------- Fontes ----------

const SOURCES_BLOCK = /\n*```kazer-fontes\n([\s\S]*?)\n```\n?/;

// Fontes salvas no fim de uma resposta (bloco que só a interface lê).
export function readSources(text) {
  const match = (text || "").match(SOURCES_BLOCK);
  if (!match) return [];
  try {
    const items = JSON.parse(match[1]);
    return Array.isArray(items) ? items.filter((item) => typeof item?.u === "string" && /^https?:\/\//.test(item.u)) : [];
  } catch {
    return [];
  }
}

const STEPS_BLOCK = /\n*```kazer-passos\n([\s\S]*?)\n```\n?/;
const IMAGES_BLOCK = /\n*```kazer-imagens\n([\s\S]*?)\n```\n?/;

export function stripSources(text) {
  return (text || "")
    .replace(SOURCES_BLOCK, "\n")
    .replace(STEPS_BLOCK, "\n")
    .replace(IMAGES_BLOCK, "\n")
    .replace(/\n*```kazer-pesquisa\n[\s\S]*?\n```\n?/, "\n")
    .replace(CITE, "")
    .replace(/^[ \t]*\[foto\s*\d{1,2}\][ \t]*\n?/gim, "")
    .replace(/\[foto\s*\d{1,2}\]/gi, "")
    .trimEnd();
}

// Fotos que a pesquisa trouxe (salvas com a resposta): só hosts permitidos.
export function readImages(text) {
  const match = (text || "").match(IMAGES_BLOCK);
  if (!match) return [];
  try {
    const items = JSON.parse(match[1]);
    return Array.isArray(items) ? items.filter((item) => IMAGE_HOST.test(String(item?.url || ""))) : [];
  } catch {
    return [];
  }
}

// Faixa de fotos no topo da resposta (como o ChatGPT faz com assuntos visuais).
export function picsStrip(items) {
  const list = (items || []).filter((item) => IMAGE_HOST.test(String(item?.url || ""))).slice(0, 8);
  if (!list.length) return null;
  const strip = h("div.pics", { role: "group", "aria-label": "Fotos da web sobre o assunto" });
  // Arrastar o dedo rola a faixa; só um toque parado abre a foto.
  let pressX = 0;
  let pressScroll = 0;
  strip.addEventListener("pointerdown", (event) => {
    pressX = event.clientX;
    pressScroll = strip.scrollLeft;
  }, { passive: true });
  const dragged = (event) => Math.abs(strip.scrollLeft - pressScroll) > 6 || Math.abs((event.clientX || pressX) - pressX) > 10;
  list.forEach((item, index) => {
    const caption = String(item.legenda || "").slice(0, 160);
    const img = h("img.pics__img", { src: item.url, alt: caption || "Foto", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    const button = h(
      "button.pics__item",
      { type: "button", title: caption, "aria-label": caption ? `Ampliar: ${caption}` : "Ampliar foto", onclick: (event) => { if (event.detail === 0 || !dragged(event)) lightbox(list, index); } },
      img,
    );
    // Foto que não carrega some sem deixar buraco.
    img.addEventListener("error", () => button.remove());
    strip.append(button);
  });
  return strip;
}

// ---------- Fotos de referência no meio da explicação (jeito ChatGPT) ----------
//
// O modelo escreve [foto N] logo depois do parágrafo que a foto ilustra; aqui o
// marcador vira a foto real que a pesquisa achou (a mesma da galeria do topo).
// Número que não existe some: nenhuma imagem é inventada.
const PHOTO_MARK = /\[foto\s*(\d{1,2})\]/gi;

function photoFigure(item, usable) {
  const caption = String(item.legenda || "").slice(0, 160);
  const img = h("img.ref-pic__img", { src: item.url, alt: caption || "Foto de referência", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  const source = item.fonte ? domain(item.fonte) : "";
  const fig = h(
    "figure.ref-pic",
    {},
    h("button.ref-pic__open", { type: "button", "aria-label": caption ? `Ampliar: ${caption}` : "Ampliar foto", onclick: () => lightbox(usable, Math.max(usable.indexOf(item), 0)) }, img),
    caption || source ? h("figcaption.ref-pic__cap", {}, caption ? h("span", { text: caption }) : null, source ? h("span.ref-pic__src", { text: source }) : null) : null,
  );
  img.addEventListener("error", () => fig.remove());
  return fig;
}

export function inlinePhotos(root, images) {
  const list = Array.isArray(images) ? images : [];
  const usable = list.filter((item) => IMAGE_HOST.test(String(item?.url || "")));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return /\[foto\s*\d/i.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const node of targets) {
    const wanted = [];
    node.nodeValue = node.nodeValue.replace(PHOTO_MARK, (_, number) => {
      const item = list[Number(number) - 1];
      if (item && usable.includes(item)) wanted.push(item);
      return "";
    });
    const block = node.parentElement?.closest("p, li, td, th, blockquote, h1, h2, h3, h4") || node.parentElement;
    if (!block) continue;
    let anchor = block;
    for (const item of wanted) {
      const fig = photoFigure(item, usable);
      // Dentro de item de lista ou tabela a foto fica lá dentro; senão, depois do parágrafo.
      if (/^(LI|TD|TH)$/.test(block.tagName)) block.append(fig);
      else {
        anchor.after(fig);
        anchor = fig;
      }
    }
    // Parágrafo que era só o marcador some (não deixa linha em branco).
    if (block.tagName === "P" && !block.textContent.trim() && !block.querySelector("img")) block.remove();
  }
}

// Passos salvos com a resposta: refazem a linha do tempo depois de recarregar.
export function readSteps(text) {
  const match = (text || "").match(STEPS_BLOCK);
  if (!match) return [];
  try {
    const items = JSON.parse(match[1]);
    return Array.isArray(items)
      ? items.filter((item) => typeof item?.l === "string").map((item, index) => ({ id: `s${index}`, label: item.l, detail: String(item.d || ""), state: "done" }))
      : [];
  } catch {
    return [];
  }
}

const domain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// Domínio sem "www." (para os ícones de site na linha de pesquisa).
export { domain as siteHost };

const SOURCE_GROUPS = [
  ["lido", "Páginas lidas"],
  ["github", "GitHub"],
  ["busca", "Resultados de busca"],
  ["imagem", "Imagens"],
];

export function sourceAvatar(url) {
  const name = domain(url);
  const badge = h("span.src-avatar", { "aria-hidden": "true", text: (name.replace(/^[^a-z0-9]+/i, "")[0] || "•").toUpperCase() });
  // Cor estável por domínio: dá para reconhecer a fonte de relance.
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  badge.style.setProperty("--hue", String(hash));
  return badge;
}

export function renderSourceList(items) {
  const box = h("div.src-list");
  for (const [kind, title] of SOURCE_GROUPS) {
    const group = items.filter((item) => (item.k || "busca") === kind);
    if (!group.length) continue;
    box.append(
      h("h3.src-list__title", { text: `${title} · ${group.length}` }),
      h(
        "ul.src-list__items",
        {},
        group.map((item, index) =>
          h(
            "li",
            {},
            h(
              "a.src-row",
              { href: item.u, target: "_blank", rel: "noopener noreferrer" },
              h("span.src-row__n", { text: String(item.n || index + 1) }),
              sourceAvatar(item.u),
              h(
                "span.src-row__text",
                {},
                h("span.src-row__title", { text: item.t || domain(item.u) }),
                h("span.src-row__domain", { text: item.d ? `${domain(item.u)} · ${formatDate(item.d)}` : domain(item.u) }),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return box;
}

function formatDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

// ---------- Citações por afirmação ----------
//
// O modelo escreve "[2]" logo depois da frase que a fonte 2 sustenta. Aqui o
// marcador vira um selo com o nome do site (e "+N" quando são várias), como
// nos assistentes de pesquisa. Só vira selo o número que existe na lista de
// fontes desta resposta; número desconhecido some (nada de link inventado).

const CITE = /(?:\[\d{1,2}(?:\s*,\s*\d{1,2})*\])+/g;
const SKIP_TAGS = new Set(["CODE", "PRE", "A", "BUTTON", "SCRIPT", "STYLE"]);

function citeChip(found) {
  const first = found[0];
  const more = found.length - 1;
  const label = domain(first.u).replace(/\.(com|org|net|gov|edu)(\.br)?$/, "");
  return h(
    "button.cite",
    {
      type: "button",
      title: found.map((item) => item.t || domain(item.u)).join(" · "),
      "aria-label": `Fonte: ${found.map((item) => domain(item.u)).join(", ")}`,
      onclick: () =>
        found.length === 1
          ? window.open(first.u, "_blank", "noopener,noreferrer")
          : openSheet({ title: "Fontes desta afirmação", content: () => renderSourceList(found) }),
    },
    sourceAvatar(first.u),
    h("span.cite__name", { text: label.length > 16 ? `${label.slice(0, 15)}…` : label }),
    more > 0 ? h("span.cite__more", { text: `+${more}` }) : null,
  );
}

export function citeChips(root, sources) {
  const byNumber = new Map();
  for (const item of sources || []) {
    if (item?.n && /^https?:\/\//.test(item.u || "")) byNumber.set(Number(item.n), item);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName) || el.classList?.contains("cite")) return NodeFilter.FILTER_REJECT;
      }
      return /\[\d/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const node of targets) {
    const text = node.nodeValue;
    const out = document.createDocumentFragment();
    let last = 0;
    let changed = false;
    for (const match of text.matchAll(CITE)) {
      const numbers = [...match[0].matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));
      const found = [...new Set(numbers)].map((n) => byNumber.get(n)).filter(Boolean);
      // Sem lista de fontes (resposta sem pesquisa), "[1]" pode ser texto normal.
      if (!byNumber.size) continue;
      changed = true;
      out.append(text.slice(last, match.index).replace(/\s+$/, found.length ? " " : ""));
      if (found.length) out.append(citeChip(found));
      last = match.index + match[0].length;
    }
    if (!changed) continue;
    out.append(text.slice(last));
    node.replaceWith(out);
  }
}

// Números reais da pesquisa salvos com a resposta.
const RESEARCH_BLOCK = /\n*```kazer-pesquisa\n([\s\S]*?)\n```\n?/;

export function readResearch(text) {
  const match = (text || "").match(RESEARCH_BLOCK);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function sourcesStrip(code, closed) {
  if (!closed) return h("span", { hidden: true });
  let items = [];
  try {
    items = JSON.parse(code).filter((item) => typeof item?.u === "string" && /^https?:\/\//.test(item.u));
  } catch {
    items = [];
  }
  if (!items.length) return h("span", { hidden: true });
  // Primeiro o que foi lido de verdade; depois o resto.
  const rank = { lido: 0, github: 1, busca: 2, imagem: 3 };
  const ordered = [...items].sort((a, b) => (rank[a.k] ?? 2) - (rank[b.k] ?? 2));
  const shown = [];
  const seen = new Set();
  for (const item of ordered) {
    const host = domain(item.u);
    if (seen.has(host)) continue;
    seen.add(host);
    shown.push(item);
    if (shown.length === 3) break;
  }
  const more = items.length - shown.length;
  return h(
    "div.src-strip",
    { role: "group", "aria-label": "Fontes desta resposta" },
    shown.map((item) =>
      h("a.src-chip", { href: item.u, target: "_blank", rel: "noopener noreferrer", title: item.t || item.u }, sourceAvatar(item.u), h("span", { text: domain(item.u) })),
    ),
    h(
      "button.src-chip.src-chip--more",
      { type: "button", onclick: () => openSheet({ title: "Fontes desta resposta", content: () => renderSourceList(items) }) },
      h("span", { text: more > 0 ? `+${more} fontes` : "Ver fontes" }),
    ),
  );
}

// ---------- Galeria de imagens ----------

const IMAGE_HOST = /^https:\/\/(upload\.wikimedia\.org|api\.openverse\.org)\//;

function galleryCard(code, closed) {
  if (!closed) return h("div.gallery.is-loading", {}, h("span", { text: "Separando imagens…" }));
  let items = [];
  try {
    const data = JSON.parse(code);
    items = (Array.isArray(data) ? data : data.imagens || data.images || []).filter((item) => IMAGE_HOST.test(String(item?.url || "")));
  } catch {
    items = [];
  }
  if (!items.length) return h("span", { hidden: true });
  const grid = h(`div.gallery.gallery--${Math.min(items.length, 4)}`);
  items.slice(0, 8).forEach((item, index) => {
    const caption = String(item.legenda || item.caption || "").slice(0, 200);
    const img = h("img.gallery__img", { src: item.url, alt: caption || "Imagem", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => figure.remove());
    const figure = h(
      "figure.gallery__item",
      { tabindex: "0", role: "button", "aria-label": caption ? `Ampliar: ${caption}` : "Ampliar imagem", onclick: () => lightbox(items, index) },
      img,
      caption ? h("figcaption.gallery__cap", { text: caption }) : null,
    );
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        lightbox(items, index);
      }
    });
    grid.append(figure);
  });
  return h("div.gallery-wrap", {}, grid, h("p.gallery__credit", { text: "Imagens com licença livre (Wikimedia Commons e Openverse)." }));
}

// Abre fotos (da galeria ou anexos da própria pessoa) dentro do app.
export function openImages(items, start = 0) {
  lightbox(items, start);
}

function lightbox(items, start) {
  let index = start;
  const img = h("img.lightbox__img", { alt: "", referrerpolicy: "no-referrer" });
  const caption = h("p.lightbox__cap");
  const link = h("a.lightbox__link", { target: "_blank", rel: "noopener noreferrer", text: "Ver fonte" });
  const show = () => {
    const item = items[index];
    img.src = item.url;
    img.alt = item.legenda || "";
    caption.textContent = item.legenda || "";
    const page = String(item.fonte || item.pagina || item.url);
    link.href = /^(https:\/\/|\/api\/attachments\/)/.test(page) ? page : item.url;
    link.textContent = item.download ? "Baixar" : "Ver fonte";
    if (item.download) link.setAttribute("download", item.download);
    else link.removeAttribute("download");
  };
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    root.remove();
  };
  const step = (delta) => {
    index = (index + delta + items.length) % items.length;
    show();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
  };
  const root = h(
    "div.lightbox",
    { role: "dialog", "aria-modal": "true", "aria-label": "Imagem ampliada", onclick: (event) => event.target === root && close() },
    h("button.lightbox__close", { type: "button", "aria-label": "Fechar", onclick: close }, icon("close")),
    items.length > 1 ? h("button.lightbox__nav.lightbox__nav--prev", { type: "button", "aria-label": "Anterior", onclick: () => step(-1) }, icon("back")) : null,
    h("figure.lightbox__figure", {}, img, h("figcaption", {}, caption, link)),
    items.length > 1 ? h("button.lightbox__nav", { type: "button", "aria-label": "Próxima", onclick: () => step(1) }, icon("chevron-right")) : null,
  );
  show();
  document.addEventListener("keydown", onKey, true);
  document.body.append(root);
}

// ---------- Diagramas (Mermaid, desenhado na moldura isolada) ----------

const frameHandlers = new Map();
window.addEventListener("message", (event) => {
  for (const [frame, handler] of frameHandlers) {
    if (!frame.isConnected) {
      frameHandlers.delete(frame);
      continue;
    }
    if (event.source === frame.contentWindow) handler(event.data || {});
  }
});

function diagramHtml(code) {
  const source = JSON.stringify(code).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0f0f11;color:#e8e6e3;font:14px system-ui,sans-serif}#out{display:flex;justify-content:center;padding:16px}#out svg{max-width:100%;height:auto}pre{white-space:pre-wrap;padding:16px;color:#cfcac3;font:13px/1.5 ui-monospace,monospace}</style></head><body><div id="out"></div><script type="module">
const code=${source};const out=document.getElementById("out");
const tell=()=>parent.postMessage({kazerHeight:document.documentElement.scrollHeight},"*");
try{const m=(await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
m.initialize({startOnLoad:false,theme:"dark",securityLevel:"strict",fontFamily:"system-ui,sans-serif",themeVariables:{primaryColor:"#1d1d22",primaryBorderColor:"#d5b15a",lineColor:"#8f8a84",primaryTextColor:"#f4f2ee"}});
const r=await m.render("kz"+Date.now(),code);out.innerHTML=r.svg;}catch(e){const p=document.createElement("pre");p.className="fallback";p.textContent="Não deu para desenhar o diagrama agora. O código dele:\\n\\n"+code;out.replaceWith(p);}
tell();new ResizeObserver(tell).observe(document.body);
addEventListener("message",e=>{if(e.data&&e.data.kazerPrint)print()});
</script></body></html>`;
}

function diagramCard(code, closed) {
  if (!closed) return h("div.diagram.is-loading", {}, h("span", { text: "Desenhando o diagrama…" }));
  const html = diagramHtml(code);
  const frame = h("iframe.diagram__frame", {
    title: "Diagrama",
    src: "/preview-frame",
    sandbox: "allow-scripts allow-modals",
    referrerpolicy: "no-referrer",
    loading: "lazy",
  });
  frameHandlers.set(frame, (data) => {
    if (data.kazerPreview === "ready") frame.contentWindow?.postMessage({ kazerHtml: html }, "*");
    if (typeof data.kazerHeight === "number") frame.style.setProperty("--h", `${Math.min(Math.max(data.kazerHeight, 120), 900)}px`);
  });
  return h(
    "div.diagram",
    {},
    h(
      "div.diagram__bar",
      {},
      h("span.diagram__label", {}, icon("research"), h("span", { text: "Diagrama" })),
      h(
        "span.diagram__tools",
        {},
        h("button.code__copy", { type: "button", onclick: () => openPreview({ title: "Diagrama", html, printable: true, file: "diagrama.html" }) }, icon("globe"), h("span", { text: "Ampliar" })),
      ),
    ),
    frame,
  );
}

// ---------- Arquivo como card ----------

const LANG_LABEL = {
  html: "HTML", htm: "HTML", css: "CSS", js: "JS", javascript: "JS", jsx: "JSX", ts: "TS", typescript: "TS", tsx: "TSX",
  py: "PY", python: "PY", json: "JSON", md: "MD", markdown: "MD", sql: "SQL", sh: "SH", bash: "SH", gd: "GD",
  gdscript: "GD", java: "JAVA", c: "C", cpp: "C++", cs: "C#", go: "GO", rs: "RS", rust: "RS", rb: "RB", php: "PHP",
  kt: "KT", swift: "SWIFT", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", svg: "SVG", vue: "VUE", tscn: "TSCN",
};

function extOf(name, lang) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return LANG_LABEL[ext] || LANG_LABEL[(lang || "").toLowerCase()] || (ext || "TXT").slice(0, 4).toUpperCase();
}

// Arquivos irmãos na mesma resposta: a prévia de um index.html usa o CSS e o
// JS que vieram junto, em vez de abrir uma página quebrada.
function siblings(card) {
  const files = new Map();
  const body = card.closest(".msg__body") || card.parentElement;
  for (const node of body?.querySelectorAll(".file-card") || []) {
    if (node.kazerFile) files.set(node.kazerFile.name.split("/").pop(), node.kazerFile.code);
  }
  return files;
}

export function inlineSiblings(html, files) {
  if (!files.size) return html;
  return html
    .replace(/<link\b[^>]*href=["']\.?\/?([^"'?#]+\.css)["'][^>]*>/gi, (tag, path) => {
      const css = files.get(path.split("/").pop());
      return css === undefined ? tag : `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
    })
    .replace(/<script\b([^>]*)src=["']\.?\/?([^"'?#]+\.m?js)["']([^>]*)>\s*<\/script>/gi, (tag, before, path, after) => {
      const js = files.get(path.split("/").pop());
      if (js === undefined) return tag;
      const module = /type=["']module["']/i.test(before + after) ? ' type="module"' : "";
      return `<script${module}>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`;
    });
}

export function fileCard({ name, lang, code, closed }) {
  const lines = code ? code.split("\n").length : 0;
  const html = isPreviewable(lang, name);
  const card = h(`div.file-card${closed ? "" : ".is-writing"}`, {});
  card.kazerFile = { name, code };
  const meta = closed
    ? `${extOf(name, lang)} · ${lines} ${lines === 1 ? "linha" : "linhas"} · ${formatBytes(new Blob([code]).size)}`
    : `Escrevendo… ${lines} ${lines === 1 ? "linha" : "linhas"}`;
  const open = () => {
    const page = html ? inlineSiblings(code, siblings(card)) : "";
    openViewer({ title: name, code, lang, html: page });
  };
  card.append(
    h("span.file-card__badge", { "aria-hidden": "true", text: extOf(name, lang) }),
    h(
      "button.file-card__main",
      { type: "button", disabled: !closed, onclick: open, "aria-label": `Abrir ${name}` },
      h("span.file-card__name", { text: name.split("/").pop() }),
      h("span.file-card__meta", { text: name.includes("/") ? `${name.split("/").slice(0, -1).join("/")}/ · ${meta}` : meta }),
    ),
    closed
      ? h(
          "span.file-card__actions",
          {},
          html ? h("button.file-card__btn.is-primary", { type: "button", onclick: open }, icon("globe"), h("span", { text: "Prévia" })) : null,
          h("button.file-card__btn", { type: "button", "aria-label": `Baixar ${name}`, onclick: () => downloadText(name, code) }, icon("down")),
        )
      : h("span.file-card__spin", { "aria-hidden": "true" }),
  );
  return card;
}

// Visualizador: código com copiar/baixar e, em páginas, a prévia ao vivo.
export function openViewer({ title, code, lang, html }) {
  const viewer = openPreview({ title, html: html || "", file: title, code, lang, start: html ? "preview" : "code" });
  return viewer;
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
    h("span", { text: blocked ? "Disponível no computador" : godot ? `Baixar ${name}` : name }),
  );
  const shown = files.slice(0, 8);
  const rest = files.length - shown.length;
  if (!godot) {
    // Os arquivos já aparecem como cards: aqui só o atalho para baixar tudo.
    return h(
      "div.bundle.bundle--compact",
      {},
      h("span.bundle__icon", { "aria-hidden": "true" }, icon("file")),
      h("div.bundle__text", {}, h("strong", { text: "Baixar tudo" }), h("span", { text: `${files.length} arquivos · ${formatBytes(size)} · .zip` })),
      download,
    );
  }
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

export function openPreview({ title, html, print = false, printable = false, file = "", code = null, lang = "", start = "preview" }) {
  preview?.close();
  const hasPage = Boolean(html);
  const frame = h("iframe.preview__frame", {
    title: `Prévia: ${title}`,
    // Sem allow-same-origin: a página roda numa origem opaca, sem cookies,
    // sem sessão e sem acesso à API do KAZER.
    sandbox: "allow-scripts allow-modals allow-popups allow-downloads allow-pointer-lock allow-forms",
    allow: "fullscreen",
    referrerpolicy: "no-referrer",
  });
  let ready = false;
  const post = (message) => frame.contentWindow?.postMessage(message, "*");
  const deliver = () => {
    if (ready) return;
    ready = true;
    post({ kazerHtml: html });
    root.classList.add("is-ready");
    if (print) window.setTimeout(() => post({ kazerPrint: true }), 900);
  };
  const onMessage = (event) => {
    if (event.source === frame.contentWindow && event.data?.kazerPreview === "ready") deliver();
  };
  window.addEventListener("message", onMessage);
  // Rede: se o aviso "pronto" se perder, a página vai assim que a moldura carregar.
  frame.addEventListener("load", () => window.setTimeout(deliver, 350));

  const view = { mode: hasPage ? start : "code" };
  const codeBox = code !== null
    ? h(
        "div.preview__code",
        {},
        h("pre", { tabindex: "0" }, h("code", { text: code })),
      )
    : null;
  const tabs = code !== null && hasPage
    ? h(
        "div.preview__sizes.preview__tabs",
        { role: "tablist", "aria-label": "Ver" },
        [
          ["preview", "Prévia"],
          ["code", "Código"],
        ].map(([mode, label]) =>
          h("button.preview__size", {
            type: "button",
            role: "tab",
            "aria-selected": String(view.mode === mode),
            "aria-checked": String(view.mode === mode),
            text: label,
            onclick: () => setMode(mode),
          }),
        ),
      )
    : null;
  const widths = hasPage
    ? h(
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
      )
    : null;
  const stage = h(
    "div.preview__stage",
    {},
    hasPage ? frame : null,
    hasPage ? h("div.preview__wait", { "aria-hidden": "true" }, mark("preview__mark")) : null,
    codeBox,
  );
  const setMode = (mode) => {
    view.mode = mode;
    root.classList.toggle("is-code", mode === "code");
    if (tabs) for (const tab of tabs.children) {
      const on = tab.textContent === (mode === "code" ? "Código" : "Prévia");
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("aria-checked", String(on));
    }
    if (widths) widths.hidden = mode === "code";
  };
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
  const copy = async (button) => {
    const { copyText } = await import("./markdown.js");
    const ok = await copyText(code || html);
    button.lastChild.textContent = ok ? "Copiado" : "Falhou";
    window.setTimeout(() => (button.lastChild.textContent = "Copiar"), 1500);
  };
  const closeButton = h("button.preview__btn.preview__close", { type: "button", "aria-label": "Fechar", onclick: close }, icon("close"));
  const root = h(
    "div.preview",
    { role: "dialog", "aria-modal": "true", "aria-label": title },
    h(
      "div.preview__bar",
      {},
      h("div.preview__title", {}, h("span.preview__dot", { "aria-hidden": "true" }), h("span", { text: title })),
      tabs,
      widths,
      h(
        "div.preview__tools",
        {},
        printable
          ? h("button.preview__btn", { type: "button", onclick: () => post({ kazerPrint: true }) }, icon("down"), h("span", { text: "PDF" }))
          : null,
        code !== null
          ? h("button.preview__btn", { type: "button", onclick: (event) => copy(event.currentTarget) }, icon("copy"), h("span", { text: "Copiar" }))
          : null,
        h(
          "button.preview__btn",
          {
            type: "button",
            onclick: () => downloadText(file || (/\.html?$/i.test(title) ? title : `${title}.html`), code !== null ? code : html),
          },
          icon("down"),
          h("span", { text: "Baixar" }),
        ),
        closeButton,
      ),
    ),
    stage,
  );
  if (hasPage) frame.src = "/preview-frame";
  else root.classList.add("is-ready");
  setMode(view.mode);
  document.addEventListener("keydown", onKey, true);
  document.body.append(root);
  window.requestAnimationFrame(() => {
    root.classList.add("is-open");
    closeButton.focus({ preventScroll: true });
  });
  preview = { close };
  return preview;
}
