// Biblioteca do KAZER: num lugar só, o que a pessoa enviou (fotos, documentos,
// arquivos) e o que o KAZER produziu (artefatos).
//
// Mora na gaveta, na mesma aba do histórico, e só é baixada quando a pessoa
// abre a aba — no celular isso é a diferença entre abrir rápido e engasgar.
//
// Carrega uma página por vez e as miniaturas só quando chegam perto da tela:
// uma conta com muita foto não pode pesar no aparelho.

import { copyText } from "./markdown.js";
import { formatBytes, formatDate, h, icon, loadStyle, mark } from "./dom.js";
import { request } from "./net.js";
import { openSheet, toast } from "./sheets.js";

const FILTERS = [
  ["tudo", "Tudo", "sparkle"],
  ["artefato", "Do KAZER", "book"],
  ["imagem", "Imagens", "image"],
  ["documento", "Docs", "file"],
];

const KIND_ICONS = {
  code: "compose",
  document: "file",
  diagram: "research",
  image: "image",
  data: "sliders",
  text: "file",
  pdf: "file",
};

const KIND_LABELS = {
  code: "Código",
  document: "Documento",
  diagram: "Diagrama",
  image: "Imagem",
  data: "Dados",
  text: "Texto",
  pdf: "PDF",
};

export function createLibrary({ onOpenConversation } = {}) {
  const root = h("div.library", { hidden: true });
  const state = { filter: "tudo", next: null, loading: false, done: false, started: false, stale: false };

  const chips = h(
    "div.library__filters",
    { role: "tablist", "aria-label": "Filtrar a biblioteca" },
    FILTERS.map(([id, label, name]) =>
      h(
        "button.library__chip",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(id === "tudo"),
          dataset: { filter: id },
          onclick: () => setFilter(id),
        },
        icon(name),
        h("span", { text: label }),
      ),
    ),
  );

  const grid = h("div.library__grid");
  const empty = h("p.library__empty", { hidden: true });
  const more = h("div.library__more", { "aria-hidden": "true" });
  const spinner = h("div.library__loading", { hidden: true }, mark("library__mark"));
  root.append(chips, grid, empty, spinner, more);
  // Espera longa: o Kazinho entra levantando peso (só depois do atraso).
  let heavy = null;

  // Carrega a próxima página quando o fim da lista entra na tela.
  const sentinel = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  });
  sentinel.observe(more);

  // Miniatura só quando o cartão chega perto: a conta pode ter centenas.
  const lazy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
        lazy.unobserve(img);
      }
    },
    { rootMargin: "200px" },
  );

  function setFilter(id) {
    if (state.filter === id) return;
    state.filter = id;
    for (const chip of chips.children) chip.setAttribute("aria-selected", String(chip.dataset.filter === id));
    reset();
    load();
  }

  function reset() {
    state.next = null;
    state.done = false;
    grid.replaceChildren();
    empty.hidden = true;
  }

  async function load() {
    if (state.loading || state.done) return;
    state.loading = true;
    spinner.hidden = false;
    if (!grid.children.length) {
      const { createLoader } = await import("./loader.js");
      heavy = heavy || createLoader(spinner, { label: "Montando sua biblioteca…" });
      heavy.start();
    }
    const query = new URLSearchParams({ kind: state.filter });
    if (state.next) query.set("before", state.next);
    const result = await request(`/api/library?${query}`);
    state.loading = false;
    spinner.hidden = true;
    heavy?.stop();
    if (!result.ok) {
      state.done = true;
      if (!grid.children.length) showEmpty("Não deu para abrir a biblioteca agora.");
      return;
    }
    const { items, has_more: hasMore, next } = result.data;
    for (const item of items) grid.append(card(item));
    state.next = next || null;
    state.done = !hasMore || !next;
    if (!grid.children.length) showEmpty(emptyText());
  }

  function emptyText() {
    if (state.filter === "artefato") return "Ainda não há nada feito pelo KAZER. Peça uma página, um componente ou um diagrama.";
    if (state.filter === "imagem") return "Nenhuma imagem enviada ainda.";
    if (state.filter === "documento") return "Nenhum documento enviado ainda.";
    return "Sua biblioteca está vazia. O que você enviar e o que o KAZER criar aparece aqui.";
  }

  function showEmpty(text) {
    empty.textContent = text;
    empty.hidden = false;
  }

  function card(item) {
    const made = item.source === "kazer";
    const isImage = item.kind === "image" && !made;
    const thumb = isImage
      ? h("img.library__thumb", { alt: "", loading: "lazy", decoding: "async", dataset: { src: `/api/attachments/${item.id}` } })
      : h("span.library__glyph", { "aria-hidden": "true" }, icon(KIND_ICONS[item.kind] || "file"));
    if (isImage) lazy.observe(thumb);

    const meta = [KIND_LABELS[item.kind] || item.kind, item.size ? formatBytes(item.size) : "", formatDate(item.created_at)]
      .filter(Boolean)
      .join(" · ");

    return h(
      `article.library__card${made ? ".is-made" : ""}`,
      {},
      h(
        "button.library__open",
        { type: "button", onclick: () => open(item), "aria-label": `Abrir ${item.title}` },
        h("span.library__media", {}, thumb, made ? h("span.library__badge", { text: "KAZER" }) : null),
        h(
          "span.library__text",
          {},
          h("span.library__name", { text: item.title || item.name || "Sem nome" }),
          h("span.library__meta", { text: meta }),
        ),
      ),
    );
  }

  async function open(item) {
    if (item.source === "kazer") return openArtifact(item);
    if (item.kind === "image") return openImage(item);
    // Documento: o navegador baixa ou abre no visualizador dele.
    window.open(`/api/attachments/${item.id}`, "_blank", "noopener");
  }

  function openImage(item) {
    openSheet({
      title: item.title || item.name,
      kind: "alert",
      content: h(
        "div.library__view",
        {},
        h("img.library__full", { src: `/api/attachments/${item.id}`, alt: item.title || "" }),
        h(
          "div.library__actions",
          {},
          h("a.library__action", { href: `/api/attachments/${item.id}`, download: item.name || item.title }, icon("download"), h("span", { text: "Baixar" })),
          backToChat(item, onOpenConversation),
        ),
      ),
    });
  }

  const openArtifact = (item) => openArtifactById(item.id, { onOpenConversation });

  // Resposta nova com artefatos: a lista se atualiza sozinha.
  window.addEventListener("kazer:artifacts", () => {
    if (!state.started) return;
    if (root.hidden) {
      state.stale = true;
      return;
    }
    reset();
    load();
  });

  return {
    root,
    // A primeira abertura é quem paga o custo do estilo e da primeira página.
    async show() {
      root.hidden = false;
      if (state.started && !state.stale) return;
      state.stale = false;
      if (!state.started) {
        state.started = true;
        await loadStyle("/assets/library.css");
      }
      reset();
      load();
    },
    hide() {
      root.hidden = true;
    },
    // Resposta nova trouxe artefatos. Com a aba aberta, recarrega na hora; com
    // ela fechada, marca para recarregar quando a pessoa voltar.
    refresh() {
      if (!state.started) return;
      if (root.hidden) {
        state.stale = true;
        return;
      }
      reset();
      load();
    },
    destroy() {
      sentinel.disconnect();
      lazy.disconnect();
    },
  };
}

// ---------- Abrir um artefato de qualquer lugar ----------

// Usada pela faixa embaixo da resposta e pela própria Biblioteca.
export async function openArtifactById(id, { onOpenConversation } = {}) {
  await loadStyle("/assets/library.css");
  const result = await request(`/api/artifacts/${id}`);
  if (!result.ok) {
    toast("Esse artefato não está mais aqui.");
    return;
  }
  const artifact = result.data;
  openSheet({
    title: artifact.title,
    kind: "alert",
    content: h(
      "div.library__view",
      {},
      h("p.library__kind", {
        text: `${KIND_LABELS[artifact.kind] || artifact.kind}${artifact.language ? ` · ${artifact.language}` : ""}`,
      }),
      h("pre.library__code", {}, h("code", { text: artifact.content })),
      h(
        "div.library__actions",
        {},
        h(
          "button.library__action",
          {
            type: "button",
            onclick: async (event) => {
              const ok = await copyText(artifact.content);
              toast(ok ? "Copiado." : "Não deu para copiar.");
              event.currentTarget.blur();
            },
          },
          icon("copy"),
          h("span", { text: "Copiar" }),
        ),
        h(
          "a.library__action",
          {
            href: URL.createObjectURL(new Blob([artifact.content], { type: "text/plain" })),
            download: fileName(artifact),
          },
          icon("download"),
          h("span", { text: "Baixar" }),
        ),
        backToChat(artifact, onOpenConversation),
      ),
    ),
  });
}

function backToChat(item, onOpenConversation) {
  if (!item.conversation_id || !onOpenConversation) return null;
  return h(
    "button.library__action",
    {
      type: "button",
      onclick: async () => {
        const { closeSheet } = await import("./sheets.js");
        await closeSheet();
        onOpenConversation(item.conversation_id);
      },
    },
    icon("compose"),
    h("span", { text: "Ver na conversa" }),
  );
}

// Nome do arquivo baixado, com a extensão que a linguagem pede.
function fileName(artifact) {
  const base = (artifact.title || "artefato").replace(/[^\w\-. ]+/g, "").trim() || "artefato";
  const ext =
    { html: "html", svg: "svg", css: "css", json: "json", csv: "csv", md: "md", markdown: "md", python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts" }[
      artifact.language
    ] ||
    artifact.language ||
    "txt";
  return base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}
