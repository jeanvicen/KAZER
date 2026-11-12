// Criar imagem: um pedido em texto vira imagem, com formato e estilo.
//
// O que esta tela NÃO decide: se a criação está ligada, quantas imagens restam
// e quando a cota volta. Tudo isso vem de `/api/images` (o banco é a fonte da
// verdade). Sem provedor de imagem ligado no servidor, a tela diz isso com
// todas as letras em vez de mostrar um botão que não faz nada.

import { h, icon, uuid } from "./dom.js";
import { locale, t } from "./i18n.js";
import { request } from "./net.js";
import { confirmDialog, toast } from "./sheets.js";

const ASPECT_LABELS = { "1:1": "Quadrado", "4:5": "Retrato", "9:16": "Story", "16:9": "Paisagem" };
const STYLE_LABELS = {
  foto: "Foto",
  ilustracao: "Ilustração",
  "3d": "3D",
  pixel: "Pixel art",
  minimal: "Minimalista",
};
const ERRORS = {
  image_unavailable: "A criação de imagens não está ligada neste KAZER.",
  image_prompt_short: "Descreva a imagem com um pouco mais de detalhe.",
  image_prompt_long: "O pedido ficou longo demais. Tente resumir.",
  image_in_progress: "Já existe uma imagem sendo criada na sua conta. Espere ela terminar.",
  image_busy: "O servidor de imagens está ocupado agora. Tente de novo em instantes: sua imagem de hoje continua guardada.",
  image_timeout: "A imagem demorou demais e foi cancelada. Sua imagem de hoje não foi gasta.",
  image_failed: "Não deu para criar a imagem agora. Sua imagem de hoje não foi gasta.",
  image_invalid: "O servidor de imagens devolveu um arquivo inválido. Sua imagem de hoje não foi gasta.",
  image_too_large: "A imagem gerada passou do tamanho permitido. Sua imagem de hoje não foi gasta.",
  rate_limited: "Muitas tentativas seguidas. Espere um pouco antes de tentar de novo.",
  maintenance: "O KAZER está em manutenção.",
  chat_unavailable: "O armazenamento do KAZER ainda não está pronto para guardar imagens.",
  timeout: "A conexão demorou demais. Se a imagem ficou pronta, ela aparece aqui embaixo em instantes.",
  network: "Sem conexão. Confira a internet e tente de novo.",
};

function resetText(seconds) {
  const when = new Date(seconds * 1000);
  const time = when.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const day = when.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
  return t("Você já usou sua imagem de hoje. A próxima fica disponível às {hora} de {dia} (seu horário).", {
    hora: time,
    dia: day,
  });
}

export function createImageMaker({ onUseInStudio } = {}) {
  const state = { status: null, aspect: "1:1", style: "", busy: false, key: uuid() };
  const root = h("div.mk");
  const refreshButton = h("button.sc__refresh", {
    type: "button",
    hidden: true,
    tabindex: "-1",
    "aria-hidden": "true",
    onclick: () => load(),
  });

  const prompt = h("textarea.mk__prompt", {
    id: "mk-prompt",
    rows: "4",
    maxlength: "800",
    placeholder: "Ex.: um farol numa ilha rochosa ao pôr do sol, mar agitado, luz dourada",
  });
  const counter = h("span.mk__count", { "aria-hidden": "true", text: "0/800" });
  const quotaLine = h("p.mk__quota", { role: "status" });
  const alert = h("p.mk__alert", { role: "alert", hidden: true });
  const go = h("button.mk__go", { type: "button" }, icon("sparkle"), h("span", { text: "Criar imagem" }));
  const progress = h(
    "div.mk__progress",
    { hidden: true, role: "status" },
    h("span.mk__spinner", { "aria-hidden": "true" }),
    h("span", { text: "Criando sua imagem… pode levar até um minuto e meio." }),
  );
  const aspects = h("div.mk__chips", { role: "radiogroup", "aria-label": "Formato" });
  const styles = h("div.mk__chips", { role: "radiogroup", "aria-label": "Estilo" });
  const form = h(
    "section.mk__form",
    {},
    h("label.mk__label", { for: "mk-prompt", text: "Descreva a imagem" }),
    h("div.mk__field", {}, prompt, counter),
    h("p.mk__label", { text: "Formato" }),
    aspects,
    h("p.mk__label", { text: "Estilo" }),
    styles,
    alert,
    h("div.mk__actions", {}, go, quotaLine),
    progress,
  );
  const notice = h("div.mk__notice", { hidden: true });
  const galleryTitle = h("h3.mk__section", { text: "Suas imagens", hidden: true });
  const gallery = h("div.mk__grid");
  const loading = h("p.mk__loading", { text: "Carregando…" });
  root.append(loading, notice, form, galleryTitle, gallery, refreshButton);
  form.hidden = true;

  function chips(host, options, current, onPick) {
    host.replaceChildren(
      ...options.map(([value, label]) =>
        h("button.mk__chip", {
          type: "button",
          role: "radio",
          "aria-checked": String(value === current),
          text: label,
          onclick: () => onPick(value),
        }),
      ),
    );
  }

  function showAlert(text) {
    alert.textContent = text || "";
    alert.hidden = !text;
  }

  function renderForm() {
    const { status } = state;
    chips(
      aspects,
      status.aspects.map((value) => [value, ASPECT_LABELS[value] || value]),
      state.aspect,
      (value) => {
        state.aspect = value;
        renderForm();
      },
    );
    chips(
      styles,
      [["", "Livre"], ...status.styles.map((value) => [value, STYLE_LABELS[value] || value])],
      state.style,
      (value) => {
        state.style = value;
        renderForm();
      },
    );
    const quota = status.quota;
    const blocked = quota.remaining <= 0;
    if (blocked && quota.in_progress > 0) quotaLine.textContent = t("Há uma imagem sendo criada agora.");
    else if (blocked) quotaLine.textContent = resetText(quota.resets_at);
    else if (quota.limit === 1) quotaLine.textContent = t("1 imagem por dia. A de hoje está disponível.");
    else quotaLine.textContent = t("Restam {n} de {total} imagens hoje.", { n: quota.remaining, total: quota.limit });
    quotaLine.classList.toggle("is-out", blocked);
    go.disabled = state.busy || blocked;
    progress.hidden = !state.busy;
    prompt.disabled = state.busy;
  }

  function card(image) {
    const picture = h("img.mk__img", {
      src: image.url,
      alt: image.prompt || t("Imagem criada no KAZER"),
      loading: "lazy",
      decoding: "async",
      width: String(image.width),
      height: String(image.height),
    });
    const download = h(
      "a.mk__tool",
      { href: image.url, download: `kazer-${image.id.slice(0, 8)}.${image.media_type === "image/jpeg" ? "jpg" : image.media_type === "image/webp" ? "webp" : "png"}`, "aria-label": t("Baixar imagem"), title: t("Baixar") },
      icon("download"),
    );
    const toStudio = onUseInStudio
      ? h(
          "button.mk__tool",
          { type: "button", "aria-label": t("Usar no Studio"), title: t("Usar no Studio"), onclick: () => useInStudio(image) },
          icon("layers"),
        )
      : null;
    const remove = h(
      "button.mk__tool",
      { type: "button", "aria-label": t("Apagar imagem"), title: t("Apagar"), onclick: (event) => removeImage(image, event.currentTarget) },
      icon("trash"),
    );
    return h(
      "figure.mk__card",
      {},
      picture,
      h("figcaption.mk__cap", {}, h("span.mk__cap-text", { text: image.prompt }), h("span.mk__tools", {}, download, toStudio, remove)),
    );
  }

  async function useInStudio(image) {
    try {
      const response = await fetch(image.url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("fetch");
      onUseInStudio(await response.blob());
    } catch {
      toast(t("Não deu para abrir a imagem agora."), { tone: "error" });
    }
  }

  async function removeImage(image, opener) {
    const sure = await confirmDialog({
      title: t("Apagar esta imagem?"),
      body: t("Ela some da sua conta. A imagem de hoje continua contada como usada."),
      confirm: t("Apagar"),
      danger: true,
      opener,
    });
    if (!sure) return;
    const result = await request(`/api/images/${image.id}`, { method: "DELETE" });
    if (result.ok) load();
    else toast(t("Não deu para apagar agora."), { tone: "error" });
  }

  function render() {
    const { status } = state;
    loading.hidden = true;
    if (!status) return;
    notice.hidden = true;
    notice.replaceChildren();
    if (!status.available) {
      form.hidden = true;
      notice.hidden = false;
      notice.append(
        h("span.mk__notice-icon", { "aria-hidden": "true" }, icon("image")),
        h("h3.mk__notice-title", { text: "A criação de imagens ainda não está ligada" }),
        h("p.mk__notice-text", {
          text: "Gerar imagem precisa de um servidor com placa de vídeo, e isso tem custo. Quando o KAZER ligar o dele, é aqui que você cria: uma imagem por dia, sem pegadinha.",
        }),
      );
    } else {
      form.hidden = false;
      if (status.provider?.id === "demo") {
        notice.hidden = false;
        notice.classList.add("mk__notice--inline");
        notice.append(
          h("p.mk__notice-text", {
            text: "Modo demonstração: não há modelo de imagem ligado. O resultado é só um marcador para testar a tela e a cota.",
          }),
        );
      }
      renderForm();
    }
    const images = status.images || [];
    galleryTitle.hidden = images.length === 0;
    gallery.replaceChildren(...images.map(card));
  }

  async function load() {
    const result = await request("/api/images");
    if (!result.ok) {
      loading.hidden = false;
      loading.textContent =
        result.data.reason === "not_migrated" || result.data.error === "chat_unavailable"
          ? t("O armazenamento do KAZER ainda não está pronto para guardar imagens.")
          : t("Não deu para carregar agora. Tente de novo em instantes.");
      form.hidden = true;
      return;
    }
    state.status = result.data;
    render();
  }

  async function submit() {
    if (state.busy || !state.status) return;
    const text = prompt.value.trim();
    if (text.length < 3) {
      showAlert(t(ERRORS.image_prompt_short));
      prompt.focus();
      return;
    }
    showAlert("");
    state.busy = true;
    renderForm();
    const result = await request("/api/images", {
      body: { prompt: text, aspect: state.aspect, style: state.style, idempotency_key: state.key },
      timeout: 150000,
    });
    state.busy = false;
    // Só troca a chave quando o servidor respondeu: se a rede caiu no meio, repetir
    // com a mesma chave devolve a mesma imagem em vez de gastar outra tentativa.
    if (result.status !== 0) state.key = uuid();
    if (result.ok) {
      prompt.value = "";
      counter.textContent = "0/800";
      toast(t("Imagem criada."));
    } else if (result.data.error === "image_quota") {
      showAlert(resetText(result.data.resets_at));
    } else {
      showAlert(t(ERRORS[result.data.error] || ERRORS.image_failed));
    }
    await load();
  }

  prompt.addEventListener("input", () => {
    counter.textContent = `${prompt.value.length}/800`;
  });
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
  });
  go.addEventListener("click", submit);

  load();
  return { root, refresh: load };
}
