// KAZER Studio: editor de design em camadas.
//
// Motor de desenho: Fabric.js (MIT), servido daqui (`vendor/fabric.min.mjs`) e
// baixado só quando a pessoa abre o Studio. O resto é do KAZER: formatos,
// modelos, barra de ferramentas, camadas, desfazer, salvamento e exportação.
//
// Documento (versão 1), o mesmo que o servidor valida em `kazer/studio/service.py`:
//   {"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": {...objetos do Fabric...}}
//
// Salvamento: na conta (`/api/designs`). Se o servidor ainda não tem onde guardar
// (banco sem a migração) ou a rede caiu, o projeto fica guardado NESTE aparelho e a
// tela diz isso — nunca "Salvo" de mentira.
//
// CSP: imagens `data:` não podem ser exibidas (img-src não as permite), então toda
// imagem embutida no documento vira `blob:` na memória e volta a `data:` ao salvar.

import { h, icon, loadStyle, store } from "./dom.js";
import { locale, t } from "./i18n.js";
import { request } from "./net.js";
import { confirmDialog, openSheet, promptDialog, toast } from "./sheets.js";

const FORMATS = [
  { id: "post", name: "Post quadrado", w: 1080, h: 1080 },
  { id: "retrato", name: "Post retrato", w: 1080, h: 1350 },
  { id: "story", name: "Story", w: 1080, h: 1920 },
  { id: "capa", name: "Capa de vídeo", w: 1280, h: 720 },
  { id: "slide", name: "Slide", w: 1920, h: 1080 },
  { id: "cartaz", name: "Cartaz A4", w: 1240, h: 1754 },
];
const TEMPLATES = [
  { id: "branco", name: "Em branco" },
  { id: "anuncio", name: "Anúncio" },
  { id: "citacao", name: "Citação" },
  { id: "titulo", name: "Título e destaque" },
];
const SWATCHES = ["#f4f1ea", "#0b0b0b", "#d5b15a", "#8f8a80", "#b3402e", "#2f6f5e", "#2c4a7c", "#6b3fa0"];
const FONTS = [
  ["Inter, system-ui, sans-serif", "Sem serifa"],
  ["Georgia, 'Times New Roman', serif", "Com serifa"],
  ["'Courier New', ui-monospace, monospace", "Mono"],
];
const KEEP = ["lockMovementX", "lockMovementY", "lockScalingX", "lockScalingY", "lockRotation", "hasControls", "kzName"];
const HISTORY_MAX = 40;
const IMAGE_MAX_SIDE = 1600;
const LOCAL_KEY = "kazer:studio-local";
const LOCAL_MAX_CHARS = 1_500_000;

let fabricModule = null;
let queuedImage = null;

// Imagem vinda de outra tela (ex.: Criar imagem) para abrir num projeto novo.
export function queueImage(blob) {
  queuedImage = blob;
}

async function loadFabric() {
  if (!fabricModule) fabricModule = await import("./vendor/fabric.min.mjs");
  return fabricModule;
}

// ---------------------------------------------------------------------------
// Imagens: data: ⇄ blob: (por causa da CSP) e redução antes de embutir
// ---------------------------------------------------------------------------

const blobToData = new Map();

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",", 2);
  const type = /^data:([^;]+)/.exec(head)?.[1] || "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function displayUrl(dataUrl) {
  const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
  blobToData.set(url, dataUrl);
  return url;
}

function walkObjects(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.objects || []) walkObjects(child, visit);
}

// Documento salvo → pronto para o Fabric (imagens em blob:).
function inflate(canvasJson) {
  const copy = JSON.parse(JSON.stringify(canvasJson || {}));
  walkObjects(copy, (node) => {
    if (typeof node.src === "string" && node.src.startsWith("data:image/")) node.src = displayUrl(node.src);
    else if (typeof node.src === "string" && !node.src.startsWith("blob:")) node.src = "";
  });
  return copy;
}

// Estado do Fabric → documento salvável (imagens de volta a data:).
function deflate(canvasJson) {
  walkObjects(canvasJson, (node) => {
    if (typeof node.src === "string" && blobToData.has(node.src)) node.src = blobToData.get(node.src);
  });
  return canvasJson;
}

async function shrinkImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const keepAlpha = blob.type === "image/png" || blob.type === "image/webp";
  return canvas.toDataURL(keepAlpha ? "image/png" : "image/jpeg", 0.85);
}

// ---------------------------------------------------------------------------
// PDF de uma página com a arte em JPEG (sem biblioteca)
// ---------------------------------------------------------------------------

function pdfFromJpeg(jpeg, width, height) {
  const encoder = new TextEncoder();
  const pageW = (width * 0.75).toFixed(2);
  const pageH = (height * 0.75).toFixed(2);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    size += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const piece of body) push(piece);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  object(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}]` +
      " /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  ]);
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB` +
      ` /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    "\nendstream",
  ]);
  object(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = size;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let id = 1; id <= 5; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// ---------------------------------------------------------------------------
// Modelos: sempre objetos de verdade, editáveis
// ---------------------------------------------------------------------------

function templateObjects(fabric, id, w, hgt) {
  const unit = Math.min(w, hgt);
  const text = (value, top, size, extra = {}) =>
    new fabric.Textbox(value, {
      left: w * 0.1,
      top,
      width: w * 0.8,
      fontSize: Math.round(size),
      fontFamily: FONTS[0][0],
      fontWeight: "600",
      fill: "#f4f1ea",
      lineHeight: 1.12,
      ...extra,
    });
  if (id === "anuncio") {
    return [
      new fabric.Rect({ left: w * 0.1, top: hgt * 0.14, width: unit * 0.14, height: unit * 0.012, fill: "#d5b15a" }),
      text("Sua oferta em poucas palavras", hgt * 0.2, unit * 0.1),
      text("Explique em uma linha por que vale a pena.", hgt * 0.56, unit * 0.04, { fontWeight: "400", fill: "#c9c4b8" }),
      new fabric.Rect({ left: w * 0.1, top: hgt * 0.76, width: unit * 0.42, height: unit * 0.1, rx: unit * 0.05, ry: unit * 0.05, fill: "#d5b15a" }),
      text("Saiba mais", hgt * 0.76 + unit * 0.027, unit * 0.04, { left: w * 0.1, width: unit * 0.42, textAlign: "center", fill: "#17110a" }),
    ];
  }
  if (id === "citacao") {
    return [
      text("“", hgt * 0.1, unit * 0.3, { fill: "#d5b15a", fontFamily: FONTS[1][0] }),
      text("Escreva aqui a frase que merece destaque.", hgt * 0.34, unit * 0.075, { fontFamily: FONTS[1][0], fontWeight: "400" }),
      text("Nome de quem disse", hgt * 0.78, unit * 0.035, { fontWeight: "400", fill: "#8f8a80" }),
    ];
  }
  if (id === "titulo") {
    return [
      new fabric.Rect({ left: 0, top: 0, width: w, height: hgt * 0.012, fill: "#d5b15a" }),
      text("TÍTULO GRANDE", hgt * 0.34, unit * 0.13, { textAlign: "center", charSpacing: 40 }),
      text("Uma linha de apoio logo abaixo", hgt * 0.56, unit * 0.042, { textAlign: "center", fontWeight: "400", fill: "#c9c4b8" }),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Projetos guardados só neste aparelho (reserva quando a conta não alcança o banco)
// ---------------------------------------------------------------------------

const local = {
  all() {
    const items = store.get(LOCAL_KEY, []);
    return Array.isArray(items) ? items : [];
  },
  get(id) {
    return this.all().find((item) => item.id === id) || null;
  },
  save(design) {
    const others = this.all().filter((item) => item.id !== design.id);
    const next = [design, ...others].slice(0, 6);
    if (JSON.stringify(next).length > LOCAL_MAX_CHARS) return false;
    store.set(LOCAL_KEY, next);
    return this.get(design.id) !== null;
  },
  remove(id) {
    store.set(LOCAL_KEY, this.all().filter((item) => item.id !== id));
  },
};

const isLocalId = (id) => typeof id === "string" && id.startsWith("local-");
const serverMissing = (result) =>
  result.status === 0 || (result.status === 503 && result.data.error !== "maintenance");

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function createStudio() {
  const root = h("div.st");
  const refreshButton = h("button.sc__refresh", { type: "button", hidden: true, tabindex: "-1", "aria-hidden": "true", onclick: () => onShow() });
  let editor = null;

  function onShow() {
    if (queuedImage) {
      const blob = queuedImage;
      queuedImage = null;
      newFromImage(blob);
    } else if (!editor) showHome();
  }

  // ---------- Lista de projetos ----------

  async function showHome() {
    await closeEditor();
    const grid = h("div.st__grid");
    const status = h("p.st__status", { role: "status", text: t("Carregando…") });
    const create = h("button.st__new", { type: "button", onclick: (event) => chooseFormat(event.currentTarget) }, icon("plus"), h("span", { text: "Novo projeto" }));
    // Atalhos de começo: um toque abre o editor no formato, em branco.
    const quick = h(
      "div.st__quick",
      { role: "list", "aria-label": t("Começar por um formato") },
      FORMATS.map((format) => {
        const shape = h(`span.st__shape${format.w > format.h ? ".is-wide" : ""}`);
        shape.style.setProperty("aspect-ratio", `${format.w} / ${format.h}`);
        return h(
          "button.st__quick-item",
          {
            type: "button",
            role: "listitem",
            onclick: () => openEditor({ id: null, title: t(format.name), width: format.w, height: format.h, template: "branco" }),
          },
          h("span.st__quick-art", {}, shape),
          h("span.st__quick-name", { text: format.name }),
          h("span.st__quick-meta", { text: `${format.w}×${format.h}` }),
        );
      }),
    );
    root.replaceChildren(
      h(
        "div.st__home",
        {},
        h("div.st__hero", {}, h("h3.st__hero-title", { text: "O que vamos criar hoje?" }), h("p.st__lede", { text: "Crie posts, capas, slides e cartazes. Tudo fica editável e guardado na sua conta." }), create),
        h("p.st__section", { text: "Começar por um formato" }),
        quick,
        h("p.st__section", { text: "Seus projetos" }),
        status,
        grid,
      ),
      refreshButton,
    );
    const result = await request("/api/designs");
    const mine = result.ok ? result.data.designs : [];
    const offline = local.all();
    if (!result.ok && serverMissing(result)) {
      status.textContent = t("Sua conta ainda não alcança o armazenamento do Studio. Os projetos ficam guardados neste aparelho.");
    } else if (!result.ok) {
      status.textContent = t("Não deu para carregar seus projetos agora.");
    } else {
      status.textContent = mine.length + offline.length ? "" : t("Nenhum projeto ainda. Comece por um formato.");
    }
    status.hidden = !status.textContent;
    const cards = [...offline.map((item) => ({ ...item, local: true })), ...mine].map(projectCard);
    grid.replaceChildren(...cards);
  }

  function projectCard(item) {
    const thumb = h("span.st__thumb");
    thumb.style.setProperty("aspect-ratio", `${item.width} / ${item.height}`);
    if (item.thumb?.startsWith("data:image/")) {
      const url = URL.createObjectURL(dataUrlToBlob(item.thumb));
      const image = h("img", { src: url, alt: "", loading: "lazy" });
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      thumb.append(image);
    }
    const when = new Date((item.updated_at || 0) * 1000).toLocaleDateString(locale(), { day: "2-digit", month: "short" });
    const open = h(
      "button.st__card-open",
      { type: "button", onclick: () => openProject(item.id) },
      thumb,
      h("span.st__card-title", { text: item.title }),
      h("span.st__card-meta", { text: `${item.width}×${item.height} · ${when}${item.local ? ` · ${t("neste aparelho")}` : ""}` }),
    );
    const remove = h("button.icon-button.st__card-del", { type: "button", "aria-label": t("Apagar projeto"), onclick: (event) => removeProject(item, event.currentTarget) }, icon("trash"));
    return h("article.st__card", {}, open, remove);
  }

  async function removeProject(item, opener) {
    const sure = await confirmDialog({ title: t("Apagar este projeto?"), body: t("Não dá para desfazer."), confirm: t("Apagar"), danger: true, opener });
    if (!sure) return;
    if (isLocalId(item.id)) local.remove(item.id);
    else {
      const result = await request(`/api/designs/${item.id}`, { method: "DELETE" });
      if (!result.ok) return void toast(t("Não deu para apagar agora."), { tone: "error" });
    }
    showHome();
  }

  function chooseFormat(opener) {
    const picked = { format: FORMATS[0], template: TEMPLATES[0] };
    const formats = h("div.st__options", { role: "radiogroup", "aria-label": t("Formato") });
    const templates = h("div.st__options", { role: "radiogroup", "aria-label": t("Modelo") });
    const draw = () => {
      formats.replaceChildren(
        ...FORMATS.map((format) => {
          const shape = h(`span.st__shape${format.w > format.h ? ".is-wide" : ""}`);
          shape.style.setProperty("aspect-ratio", `${format.w} / ${format.h}`);
          return h(
            "button.st__option",
            { type: "button", role: "radio", "aria-checked": String(format === picked.format), onclick: () => ((picked.format = format), draw()) },
            h("span.st__shape-box", {}, shape),
            h("span.st__option-name", { text: format.name }),
            h("span.st__option-meta", { text: `${format.w}×${format.h}` }),
          );
        }),
      );
      templates.replaceChildren(
        ...TEMPLATES.map((template) =>
          h("button.st__pill", { type: "button", role: "radio", "aria-checked": String(template === picked.template), text: template.name, onclick: () => ((picked.template = template), draw()) }),
        ),
      );
    };
    draw();
    const sheet = openSheet({
      title: t("Novo projeto"),
      opener,
      content: h(
        "div.st__sheet",
        {},
        h("p.st__sheet-label", { text: "Formato" }),
        formats,
        h("p.st__sheet-label", { text: "Modelo" }),
        templates,
        h("button.st__primary", {
          type: "button",
          text: "Criar",
          onclick: () => {
            sheet.close();
            openEditor({ id: null, title: picked.format.name, width: picked.format.w, height: picked.format.h, template: picked.template.id });
          },
        }),
      ),
    });
  }

  async function newFromImage(blob) {
    let dataUrl;
    try {
      dataUrl = await shrinkImage(blob);
    } catch {
      toast(t("Não deu para abrir a imagem agora."), { tone: "error" });
      return showHome();
    }
    const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
    const side = 1080 / Math.max(bitmap.width, bitmap.height);
    const size = { w: Math.round(bitmap.width * side), h: Math.round(bitmap.height * side) };
    bitmap.close?.();
    openEditor({ id: null, title: t("Imagem do KAZER"), width: size.w, height: size.h, template: "branco", image: dataUrl });
  }

  async function openProject(id) {
    if (isLocalId(id)) {
      const found = local.get(id);
      if (found) openEditor(found);
      return;
    }
    const result = await request(`/api/designs/${id}`);
    if (!result.ok) return void toast(t("Não deu para abrir este projeto."), { tone: "error" });
    openEditor(result.data.design);
  }

  async function closeEditor() {
    if (!editor) return;
    const closing = editor;
    editor = null;
    await closing.destroy();
  }

  // ---------- Editor ----------

  async function openEditor(project) {
    await closeEditor();
    root.replaceChildren(h("p.st__status", { role: "status", text: t("Abrindo o editor…") }), refreshButton);
    let fabric;
    try {
      [fabric] = await Promise.all([loadFabric(), loadStyle("/assets/studio.css")]);
    } catch {
      root.replaceChildren(h("p.st__status", { role: "alert", text: t("Não deu para carregar o editor. Confira a internet e tente de novo.") }), refreshButton);
      return;
    }
    let parsed = null;
    if (project.data) {
      try {
        parsed = JSON.parse(project.data);
      } catch {
        parsed = null;
      }
    }
    const doc = { id: project.id || null, title: project.title || t("Sem título"), w: parsed?.w || project.width, h: parsed?.h || project.height, bg: parsed?.bg || "#0b0b0b" };

    const element = document.createElement("canvas");
    const stage = h("div.st__stage", {}, h("div.st__paper", {}, element));
    // O Fabric 7 posiciona pelo centro por padrão; o Studio usa o canto superior
    // esquerdo (é assim que os modelos e os documentos salvos descrevem a posição).
    fabric.FabricObject.ownDefaults.originX = "left";
    fabric.FabricObject.ownDefaults.originY = "top";
    fabric.FabricObject.ownDefaults.cornerColor = "#d5b15a";
    fabric.FabricObject.ownDefaults.cornerStrokeColor = "#17110a";
    fabric.FabricObject.ownDefaults.borderColor = "#d5b15a";
    fabric.FabricObject.ownDefaults.transparentCorners = false;
    fabric.FabricObject.ownDefaults.cornerStyle = "circle";
    fabric.FabricObject.ownDefaults.cornerSize = 14;
    fabric.FabricObject.ownDefaults.touchCornerSize = 30;
    const canvas = new fabric.Canvas(element, { backgroundColor: doc.bg, preserveObjectStacking: true, selection: true, stopContextMenu: true });

    const state = { dirty: false, saving: false, saveTimer: 0, loading: true, history: [], cursor: -1, guides: [], zoom: 1, where: isLocalId(doc.id) ? "device" : "account", destroyed: false };

    // ----- Barra de cima -----
    const title = h("button.st__title", { type: "button", title: t("Renomear"), text: doc.title });
    const saveState = h("span.st__save", { role: "status" });
    const undoButton = h("button.icon-button", { type: "button", "aria-label": t("Desfazer"), title: t("Desfazer (Ctrl Z)") }, h("span.st__glyph", { "aria-hidden": "true", text: "↶" }));
    const redoButton = h("button.icon-button", { type: "button", "aria-label": t("Refazer"), title: t("Refazer (Ctrl Shift Z)") }, h("span.st__glyph", { "aria-hidden": "true", text: "↷" }));
    const layersButton = h("button.icon-button", { type: "button", "aria-label": t("Camadas"), title: t("Camadas") }, icon("layers"));
    const exportButton = h("button.st__export", { type: "button" }, icon("download"), h("span", { text: "Exportar" }));
    const top = h(
      "div.st__top",
      {},
      h("button.icon-button", { type: "button", "aria-label": t("Voltar aos projetos"), onclick: () => leave() }, icon("chevron")),
      h("div.st__top-main", {}, title, saveState),
      undoButton,
      redoButton,
      layersButton,
      exportButton,
    );
    top.querySelector(".icon-button").classList.add("st__back");

    // ----- Barra de baixo: adicionar e editar o que está selecionado -----
    const addBar = h("div.st__bar", { role: "toolbar", "aria-label": t("Adicionar") });
    const editBar = h("div.st__bar.st__bar--edit", { role: "toolbar", "aria-label": t("Editar seleção"), hidden: true });
    const filePicker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
    const tool = (label, glyph, onClick, extra = {}) => h("button.st__tool", { type: "button", onclick: onClick, ...extra }, typeof glyph === "string" ? icon(glyph) : glyph, h("span", { text: label }));
    const glyphText = (value) => h("span.st__glyph", { "aria-hidden": "true", text: value });

    addBar.append(
      tool("Texto", glyphText("T"), () => addText()),
      tool("Retângulo", glyphText("▭"), () => addShape("rect")),
      tool("Círculo", glyphText("◯"), () => addShape("circle")),
      tool("Linha", glyphText("╱"), () => addShape("line")),
      tool("Foto", "image", () => filePicker.click()),
      tool("Fundo", glyphText("◼"), (event) => pickColor(event.currentTarget, t("Cor do fundo"), doc.bg, (value) => setBackground(value))),
    );

    root.replaceChildren(h("div.st__editor", {}, top, stage, h("div.st__bars", {}, editBar, addBar), filePicker), refreshButton);

    // ----- Tamanho: o documento tem tamanho fixo; a tela mostra com zoom -----
    function fit() {
      if (state.destroyed) return;
      const box = stage.getBoundingClientRect();
      const scale = Math.max(0.05, Math.min((box.width - 24) / doc.w, (box.height - 24) / doc.h, 1));
      state.zoom = scale;
      canvas.setDimensions({ width: Math.round(doc.w * scale), height: Math.round(doc.h * scale) });
      canvas.setZoom(scale);
      canvas.requestRenderAll();
    }
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(stage);

    // ----- Documento ⇄ Fabric -----
    const snapshot = () => JSON.stringify(deflate(canvas.toObject(KEEP)));
    const documentJson = () => JSON.stringify({ v: 1, w: doc.w, h: doc.h, bg: doc.bg, canvas: JSON.parse(snapshot()) });

    async function restore(json) {
      state.loading = true;
      await canvas.loadFromJSON(inflate(JSON.parse(json)));
      canvas.backgroundColor = doc.bg = canvas.backgroundColor || doc.bg;
      state.loading = false;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      syncSelection();
    }

    function record() {
      if (state.loading) return;
      const shot = snapshot();
      if (state.history[state.cursor] === shot) return;
      state.history = state.history.slice(0, state.cursor + 1);
      state.history.push(shot);
      if (state.history.length > HISTORY_MAX) state.history.shift();
      state.cursor = state.history.length - 1;
      markDirty();
      syncHistory();
    }

    async function step(direction) {
      const next = state.cursor + direction;
      if (next < 0 || next >= state.history.length) return;
      state.cursor = next;
      await restore(state.history[next]);
      markDirty();
      syncHistory();
    }

    function syncHistory() {
      undoButton.disabled = state.cursor <= 0;
      redoButton.disabled = state.cursor >= state.history.length - 1;
    }

    // ----- Salvar -----
    function showSave(kind) {
      const labels = {
        saved: state.where === "device" ? t("Guardado neste aparelho") : t("Salvo na conta"),
        saving: t("Salvando…"),
        dirty: t("Alterações não salvas"),
        error: t("Não deu para salvar"),
      };
      saveState.textContent = labels[kind];
      saveState.dataset.state = kind;
    }

    function markDirty() {
      state.dirty = true;
      showSave("dirty");
      window.clearTimeout(state.saveTimer);
      state.saveTimer = window.setTimeout(() => save(), 2200);
    }

    async function thumbnail() {
      const scale = Math.min(1, 320 / Math.max(doc.w, doc.h));
      const still = await renderStill(scale);
      let quality = 0.7;
      let data = still.toDataURL("image/jpeg", quality);
      while (data.length > 58_000 && quality > 0.3) data = still.toDataURL("image/jpeg", (quality -= 0.15));
      return data.length > 58_000 ? "" : data;
    }

    async function save() {
      window.clearTimeout(state.saveTimer);
      if (state.saving || state.destroyed) return false;
      state.saving = true;
      state.dirty = false;
      showSave("saving");
      const body = { title: doc.title, data: documentJson(), thumb: await thumbnail().catch(() => "") };
      let ok = false;
      if (!isLocalId(doc.id)) {
        const result = doc.id
          ? await request(`/api/designs/${doc.id}`, { method: "PUT", body, timeout: 30000 })
          : await request("/api/designs", { body, timeout: 30000 });
        if (result.ok) {
          doc.id = result.data.design.id;
          state.where = "account";
          ok = true;
        } else if (serverMissing(result)) {
          // Sem banco para o Studio (ou sem rede): guarda neste aparelho e diz isso.
          if (!doc.id) doc.id = `local-${Date.now().toString(36)}`;
          state.where = "device";
        } else if (result.data.error === "design_limit") {
          toast(t("Você chegou ao limite de projetos do seu plano. Apague um para salvar este."), { tone: "error" });
        } else if (result.data.error === "design_too_large") {
          toast(t("O projeto ficou grande demais para salvar. Tire ou reduza alguma foto."), { tone: "error" });
        }
      }
      if (!ok && state.where === "device" && (isLocalId(doc.id) || !doc.id)) {
        if (!doc.id) doc.id = `local-${Date.now().toString(36)}`;
        ok = local.save({ id: doc.id, title: doc.title, width: doc.w, height: doc.h, data: body.data, thumb: body.thumb, updated_at: Math.floor(Date.now() / 1000) });
      }
      state.saving = false;
      if (state.destroyed) return ok;
      if (!ok) {
        state.dirty = true;
        showSave("error");
      } else if (state.dirty) markDirty();
      else showSave("saved");
      return ok;
    }

    // ----- Renderização fora da tela (miniatura e exportação no tamanho real) -----
    async function renderStill(multiplier = 1) {
      const still = new fabric.StaticCanvas(undefined, { width: doc.w, height: doc.h, backgroundColor: doc.bg, enableRetinaScaling: false });
      await still.loadFromJSON(inflate(JSON.parse(snapshot())));
      still.backgroundColor = doc.bg;
      still.renderAll();
      const output = still.toCanvasElement(multiplier);
      await still.dispose();
      return output;
    }

    async function exportAs(kind) {
      const name = (doc.title || "kazer").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "kazer";
      try {
        const still = await renderStill(1);
        if (kind === "png") download(await toBlob(still, "image/png"), `${name}.png`);
        else {
          const jpeg = await toBlob(still, "image/jpeg", 0.92);
          if (kind === "jpg") download(jpeg, `${name}.jpg`);
          else download(pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), still.width, still.height), `${name}.pdf`);
        }
        toast(t("Arquivo exportado em {w}×{h} px.", { w: still.width, h: still.height }));
      } catch {
        toast(t("Não deu para exportar agora."), { tone: "error" });
      }
    }

    // ----- Adicionar -----
    // Centro da PÁGINA (coordenadas do documento), não da tela com zoom.
    const center = (object) => object.setPositionByOrigin(new fabric.Point(doc.w / 2, doc.h / 2), "center", "center");

    function place(object) {
      canvas.add(object);
      center(object);
      object.setCoords();
      canvas.setActiveObject(object);
      canvas.requestRenderAll();
      record();
    }

    function addText() {
      const size = Math.round(Math.min(doc.w, doc.h) * 0.07);
      place(new fabric.Textbox(t("Seu texto"), { width: doc.w * 0.6, fontSize: size, fontFamily: FONTS[0][0], fontWeight: "600", fill: doc.bg.toLowerCase() === "#f4f1ea" ? "#0b0b0b" : "#f4f1ea", textAlign: "center" }));
    }

    function addShape(kind) {
      const unit = Math.min(doc.w, doc.h);
      if (kind === "rect") place(new fabric.Rect({ width: unit * 0.4, height: unit * 0.26, fill: "#d5b15a", rx: 0, ry: 0 }));
      else if (kind === "circle") place(new fabric.Circle({ radius: unit * 0.16, fill: "#d5b15a" }));
      else place(new fabric.Line([0, 0, unit * 0.5, 0], { stroke: "#d5b15a", strokeWidth: Math.max(4, unit * 0.008), strokeLineCap: "round" }));
    }

    async function addImage(dataUrl, { cover = false } = {}) {
      const image = await fabric.FabricImage.fromURL(displayUrl(dataUrl));
      const scale = cover ? Math.max(doc.w / image.width, doc.h / image.height) : Math.min((doc.w * 0.7) / image.width, (doc.h * 0.7) / image.height, 1);
      image.scale(scale);
      place(image);
      if (cover) canvas.sendObjectToBack(image);
    }

    filePicker.addEventListener("change", async () => {
      const file = filePicker.files?.[0];
      filePicker.value = "";
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) {
        return void toast(t("Use uma foto PNG, JPEG ou WebP de até 15 MB."), { tone: "error" });
      }
      try {
        await addImage(await shrinkImage(file));
      } catch {
        toast(t("Não deu para abrir esta foto."), { tone: "error" });
      }
    });

    function setBackground(value) {
      doc.bg = value;
      canvas.backgroundColor = value;
      canvas.requestRenderAll();
      record();
    }

    // ----- Editar seleção -----
    const selected = () => canvas.getActiveObject() || null;
    const isText = (object) => object?.isType?.("textbox", "i-text", "text");
    const isMulti = (object) => object?.isType?.("activeselection");
    const isGroup = (object) => object?.isType?.("group");
    const locked = (object) => Boolean(object?.lockMovementX);

    function change(apply) {
      const object = selected();
      if (!object) return;
      apply(object);
      object.setCoords();
      canvas.requestRenderAll();
      record();
      syncSelection();
    }

    function pickColor(opener, label, current, onPick) {
      const native = h("input.st__color-native", { type: "color", value: /^#[0-9a-f]{6}$/i.test(current) ? current : "#d5b15a", "aria-label": t("Outra cor") });
      native.addEventListener("change", () => (onPick(native.value), sheet.close()));
      const sheet = openSheet({
        title: label,
        opener,
        content: h(
          "div.st__colors",
          {},
          ...SWATCHES.map((value) => {
            const swatch = h("button.st__swatch", { type: "button", "aria-label": value, onclick: () => (onPick(value), sheet.close()) });
            swatch.style.setProperty("background-color", value);
            return swatch;
          }),
          h("label.st__swatch.st__swatch--custom", { title: t("Outra cor") }, icon("plus"), native),
        ),
      });
    }

    async function duplicate() {
      const object = selected();
      if (!object) return;
      const copy = await object.clone(KEEP);
      copy.set({ left: (object.left || 0) + 24, top: (object.top || 0) + 24 });
      if (isMulti(copy)) {
        copy.canvas = canvas;
        copy.forEachObject((item) => canvas.add(item));
        copy.setCoords();
      } else canvas.add(copy);
      canvas.setActiveObject(copy);
      canvas.requestRenderAll();
      record();
    }

    function removeSelected() {
      const object = selected();
      if (!object || object.isEditing) return;
      const items = isMulti(object) ? object.getObjects() : [object];
      canvas.discardActiveObject();
      canvas.remove(...items);
      canvas.requestRenderAll();
      record();
    }

    function setLock(object, on) {
      object.set({ lockMovementX: on, lockMovementY: on, lockScalingX: on, lockScalingY: on, lockRotation: on, hasControls: !on });
    }

    function group() {
      const object = selected();
      if (!isMulti(object)) return;
      const items = object.removeAll();
      canvas.discardActiveObject();
      canvas.remove(...items);
      const made = new fabric.Group(items);
      canvas.add(made);
      canvas.setActiveObject(made);
      canvas.requestRenderAll();
      record();
    }

    function ungroup() {
      const object = selected();
      if (!isGroup(object)) return;
      const items = object.removeAll();
      canvas.remove(object);
      canvas.add(...items);
      const selection = new fabric.ActiveSelection(items, { canvas });
      canvas.setActiveObject(selection);
      canvas.requestRenderAll();
      record();
    }

    function syncSelection() {
      const object = selected();
      editBar.hidden = !object;
      addBar.hidden = Boolean(object);
      if (!object) return;
      const text = isText(object);
      const colorKey = object.isType?.("line") ? "stroke" : "fill";
      const items = [
        tool("Pronto", "check", () => (canvas.discardActiveObject(), canvas.requestRenderAll())),
      ];
      if (text) {
        items.push(
          tool("Editar", "edit", () => {
            object.enterEditing();
            object.selectAll();
            canvas.requestRenderAll();
          }),
          tool("Menor", glyphText("A−"), () => change((o) => o.set("fontSize", Math.max(8, Math.round(o.fontSize * 0.9))))),
          tool("Maior", glyphText("A+"), () => change((o) => o.set("fontSize", Math.min(800, Math.round(o.fontSize * 1.1))))),
          tool("Negrito", glyphText("B"), () => change((o) => o.set("fontWeight", String(o.fontWeight) === "400" ? "700" : "400")), { "aria-pressed": String(String(object.fontWeight) !== "400") }),
          tool("Alinhar", glyphText("≡"), () => change((o) => o.set("textAlign", { left: "center", center: "right", right: "left" }[o.textAlign] || "left"))),
          tool("Fonte", glyphText("Aa"), () =>
            change((o) => {
              const index = FONTS.findIndex(([family]) => family === o.fontFamily);
              o.set("fontFamily", FONTS[(index + 1) % FONTS.length][0]);
            }),
          ),
        );
      }
      if (!isMulti(object) && !isGroup(object) && !object.isType?.("image")) {
        items.push(tool("Cor", glyphText("●"), (event) => pickColor(event.currentTarget, t("Cor"), object[colorKey] || "#d5b15a", (value) => change((o) => o.set(colorKey, value)))));
      }
      if (isMulti(object)) items.push(tool("Agrupar", glyphText("⧉"), () => group()));
      if (isGroup(object)) items.push(tool("Desagrupar", glyphText("⧈"), () => ungroup()));
      items.push(
        tool("Centralizar", glyphText("⌖"), () => change((o) => center(o))),
        tool("Frente", glyphText("⤒"), () => change((o) => canvas.bringObjectForward(o))),
        tool("Trás", glyphText("⤓"), () => change((o) => canvas.sendObjectBackwards(o))),
        tool("Duplicar", "copy", () => duplicate()),
        tool(locked(object) ? "Destravar" : "Travar", "lock", () => change((o) => setLock(o, !locked(o))), { "aria-pressed": String(locked(object)) }),
        tool("Apagar", "trash", () => removeSelected(), { dataset: { tone: "danger" } }),
      );
      editBar.replaceChildren(...items);
    }

    // ----- Camadas -----
    function layerName(object) {
      if (object.kzName) return object.kzName;
      if (isText(object)) return (object.text || t("Texto")).split("\n")[0].slice(0, 32) || t("Texto");
      if (object.isType?.("image")) return t("Foto");
      if (object.isType?.("rect")) return t("Retângulo");
      if (object.isType?.("circle")) return t("Círculo");
      if (object.isType?.("line")) return t("Linha");
      if (isGroup(object)) return t("Grupo");
      return t("Objeto");
    }

    function openLayers(opener) {
      const list = h("ul.st__layers");
      const draw = () => {
        const objects = canvas.getObjects().slice().reverse();
        if (!objects.length) return void list.replaceChildren(h("li.st__layers-empty", { text: t("Nenhuma camada ainda.") }));
        list.replaceChildren(
          ...objects.map((object) => {
            const act = (apply) => () => {
              apply(object);
              object.setCoords();
              canvas.requestRenderAll();
              record();
              draw();
            };
            return h(
              "li.st__layer",
              { dataset: { active: String(selected() === object) } },
              h("button.st__layer-name", { type: "button", text: layerName(object), onclick: () => (object.visible && canvas.setActiveObject(object), canvas.requestRenderAll(), sheet.close()) }),
              h("button.icon-button", { type: "button", "aria-label": object.visible ? t("Esconder camada") : t("Mostrar camada"), "aria-pressed": String(!object.visible), onclick: act((o) => (o.set("visible", !o.visible), !o.visible && canvas.discardActiveObject())) }, glyphText(object.visible ? "◉" : "◌")),
              h("button.icon-button", { type: "button", "aria-label": locked(object) ? t("Destravar camada") : t("Travar camada"), "aria-pressed": String(locked(object)), onclick: act((o) => setLock(o, !locked(o))) }, icon("lock")),
              h("button.icon-button", { type: "button", "aria-label": t("Subir camada"), onclick: act((o) => canvas.bringObjectForward(o)) }, glyphText("↑")),
              h("button.icon-button", { type: "button", "aria-label": t("Descer camada"), onclick: act((o) => canvas.sendObjectBackwards(o)) }, glyphText("↓")),
            );
          }),
        );
      };
      draw();
      const sheet = openSheet({ title: t("Camadas"), opener, content: list });
    }

    // ----- Guias: encaixe no centro da página -----
    function snap(event) {
      const object = event.target;
      if (!object || isMulti(object)) return;
      const center = object.getCenterPoint();
      const reach = 8 / state.zoom;
      state.guides = [];
      if (Math.abs(center.x - doc.w / 2) < reach) {
        object.setPositionByOrigin(new fabric.Point(doc.w / 2, center.y), "center", "center");
        state.guides.push("v");
      }
      const after = object.getCenterPoint();
      if (Math.abs(after.y - doc.h / 2) < reach) {
        object.setPositionByOrigin(new fabric.Point(after.x, doc.h / 2), "center", "center");
        state.guides.push("h");
      }
    }

    function drawGuides() {
      if (!state.guides.length) return;
      const context = canvas.getSelectionContext();
      context.save();
      context.strokeStyle = "#d5b15a";
      context.lineWidth = 1;
      context.setLineDash([6, 4]);
      const zoom = state.zoom;
      for (const guide of state.guides) {
        context.beginPath();
        if (guide === "v") {
          context.moveTo(Math.round((doc.w / 2) * zoom) + 0.5, 0);
          context.lineTo(Math.round((doc.w / 2) * zoom) + 0.5, doc.h * zoom);
        } else {
          context.moveTo(0, Math.round((doc.h / 2) * zoom) + 0.5);
          context.lineTo(doc.w * zoom, Math.round((doc.h / 2) * zoom) + 0.5);
        }
        context.stroke();
      }
      context.restore();
    }

    canvas.on("object:moving", snap);
    canvas.on("after:render", drawGuides);
    canvas.on("mouse:up", () => {
      if (state.guides.length) {
        state.guides = [];
        canvas.requestRenderAll();
      }
    });
    canvas.on("object:modified", () => record());
    canvas.on("text:editing:exited", () => record());
    for (const name of ["selection:created", "selection:updated", "selection:cleared"]) canvas.on(name, () => syncSelection());

    // ----- Teclado -----
    function onKey(event) {
      if (state.destroyed || !root.isConnected || root.closest("[hidden]")) return;
      const field = event.target.closest?.("input, textarea, [contenteditable]");
      const object = selected();
      if (field || object?.isEditing || document.querySelector(".sheet")) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") step(event.shiftKey ? 1 : -1);
      else if (mod && key === "y") step(1);
      else if (mod && key === "d") duplicate();
      else if (mod && key === "s") save();
      else if ((key === "delete" || key === "backspace") && object) removeSelected();
      else if (key.startsWith("arrow") && object && !locked(object)) {
        const amount = event.shiftKey ? 10 : 1;
        change((o) => o.set({ left: o.left + (key === "arrowleft" ? -amount : key === "arrowright" ? amount : 0), top: o.top + (key === "arrowup" ? -amount : key === "arrowdown" ? amount : 0) }));
      } else if (key === "escape" && object) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      } else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);

    undoButton.addEventListener("click", () => step(-1));
    redoButton.addEventListener("click", () => step(1));
    layersButton.addEventListener("click", (event) => openLayers(event.currentTarget));
    title.addEventListener("click", async () => {
      const name = await promptDialog({ title: t("Nome do projeto"), label: t("Nome"), value: doc.title, maxLength: 80, opener: title });
      if (!name?.trim()) return;
      doc.title = name.trim();
      title.textContent = doc.title;
      markDirty();
    });
    exportButton.addEventListener("click", (event) => {
      const sheet = openSheet({
        title: t("Exportar"),
        opener: event.currentTarget,
        content: h(
          "div.st__export-list",
          {},
          h("p.st__sheet-note", { text: t("O arquivo sai no tamanho real do projeto: {w}×{h} px.", { w: doc.w, h: doc.h }) }),
          ...[
            ["png", "PNG", "Melhor para arte com texto: sai sem perda de qualidade."],
            ["jpg", "JPEG", "Arquivo menor, bom para fotos e redes sociais."],
            ["pdf", "PDF", "Uma página, pronto para enviar ou imprimir."],
          ].map(([kind, name, note]) =>
            h("button.st__export-item", { type: "button", onclick: () => (sheet.close(), exportAs(kind)) }, h("strong", { text: name }), h("span", { text: note })),
          ),
        ),
      });
    });

    async function leave() {
      if (state.dirty) await save();
      showHome();
    }

    const onHide = () => {
      if (document.visibilityState === "hidden" && state.dirty) save();
    };
    document.addEventListener("visibilitychange", onHide);

    editor = {
      async destroy() {
        state.destroyed = true;
        window.clearTimeout(state.saveTimer);
        resizeObserver.disconnect();
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("visibilitychange", onHide);
        await canvas.dispose();
      },
    };

    // ----- Conteúdo inicial -----
    fit();
    if (parsed?.canvas) await restore(JSON.stringify(parsed.canvas));
    else {
      for (const object of templateObjects(fabric, project.template || "branco", doc.w, doc.h)) canvas.add(object);
      if (project.image) await addImage(project.image, { cover: true });
      canvas.discardActiveObject();
    }
    state.loading = false;
    state.history = [snapshot()];
    state.cursor = 0;
    state.dirty = false;
    syncHistory();
    syncSelection();
    canvas.requestRenderAll();
    if (doc.id) showSave("saved");
    else markDirty();
  }

  root.append(refreshButton);
  loadStyle("/assets/studio.css").then(onShow);
  return { root, refresh: onShow };
}
