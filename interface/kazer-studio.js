/*
 * KAZER Studio — seletor de modelo (K.z 1.1 / Flame API), fontes e widgets
 * da pesquisa, e projetos de arquivos com prévia ao vivo e download .zip.
 * A KAZER Engine fica em kazer-engine.js.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (message) => window.kazerShowToast ? window.kazerShowToast(message) : console.info(message);
  const api = (path, options) => window.kazerWorkspace?.api ? window.kazerWorkspace.api(path, options) : Promise.reject(new Error("Sessão indisponível."));
  const store = {
    get(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } },
    set(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  /* ── Seletor de modelo ─────────────────────────────────────────────── */
  const flame = { configured: false, presets: [], loaded: false };
  window.kazerModel = store.get("kazer-model", "kz") === "flame" ? "flame" : "kz";

  const picker = document.createElement("div");
  picker.className = "kz-model";
  picker.innerHTML = `<button class="kz-model-button" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="kz-model-dot"></span><span class="kz-model-name"></span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></button><div class="kz-model-menu" role="listbox" hidden></div>`;
  const topbar = $(".topbar");
  topbar?.append(picker);
  const pickerButton = $(".kz-model-button", picker);
  const pickerMenu = $(".kz-model-menu", picker);

  function renderPicker() {
    const isFlame = window.kazerModel === "flame";
    $(".kz-model-name", picker).textContent = isFlame ? "Flame API" : "K.z 1.1";
    picker.classList.toggle("is-flame", isFlame);
    const flameDetail = flame.configured ? `${escapeHtml(flame.providerLabel)} · ${escapeHtml(flame.model)}` : "Use a API da IA que você quiser";
    pickerMenu.innerHTML = `
      <button class="kz-model-option${isFlame ? "" : " is-active"}" type="button" role="option" aria-selected="${!isFlame}" data-model="kz"><span class="kz-model-icon">K</span><span><strong>K.z 1.1</strong><small>Modelo do KAZER · pesquisa, Computer e arquivos</small></span></button>
      <button class="kz-model-option${isFlame ? " is-active" : ""}" type="button" role="option" aria-selected="${isFlame}" data-model="flame"><span class="kz-model-icon is-flame"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5Z"/></svg></span><span><strong>Flame API</strong><small>${flameDetail}</small></span></button>
      <button class="kz-model-config" type="button" data-flame-config>${flame.configured ? "Trocar chave ou modelo" : "Configurar Flame API"}</button>`;
  }

  function setModel(model) {
    if (model === "flame" && flame.loaded && !flame.configured) { openFlameConfig(); return; }
    window.kazerModel = model === "flame" ? "flame" : "kz";
    store.set("kazer-model", window.kazerModel);
    renderPicker();
    toast(window.kazerModel === "flame" ? `Flame API: ${flame.providerLabel || "sua chave"} responde agora (não usa sua cota).` : "K.z 1.1 ativo.");
  }

  pickerButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = pickerMenu.hidden;
    pickerMenu.hidden = !open;
    pickerButton.setAttribute("aria-expanded", String(open));
  });
  pickerMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-model]");
    if (option) setModel(option.dataset.model);
    if (event.target.closest("[data-flame-config]")) openFlameConfig();
    pickerMenu.hidden = true;
    pickerButton.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".kz-model")) { pickerMenu.hidden = true; pickerButton.setAttribute("aria-expanded", "false"); } });

  async function loadFlame() {
    try {
      const data = await api("/api/models");
      Object.assign(flame, data.flame || { configured: false }, { presets: data.presets || [], loaded: true });
    } catch { flame.loaded = false; }
    if (window.kazerModel === "flame" && flame.loaded && !flame.configured) window.kazerModel = "kz";
    renderPicker();
  }

  /* Modal da Flame API */
  function openFlameConfig() {
    $(".kz-flame-modal")?.remove();
    const presets = flame.presets.length ? flame.presets : [{ id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" }, { id: "custom", label: "Outra (compatível com OpenAI)", baseUrl: "", model: "" }];
    const current = presets.find((preset) => preset.id === flame.provider) || presets[0];
    const modal = document.createElement("div");
    modal.className = "kz-flame-modal";
    modal.innerHTML = `<div class="kz-flame-backdrop"></div><form class="kz-flame-card" role="dialog" aria-modal="true" aria-labelledby="kzFlameTitle">
      <header><span class="kz-model-icon is-flame"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5Z"/></svg></span><div><h2 id="kzFlameTitle">Flame API</h2><p>Use a IA que você quiser com a sua própria chave. Ela é validada, cifrada no servidor e nunca volta para o navegador. Mensagens pela Flame não gastam a cota do KAZER.</p></div></header>
      <label>Provedor<select name="provider">${presets.map((preset) => `<option value="${escapeHtml(preset.id)}"${preset.id === current.id ? " selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}</select></label>
      <label data-base>URL da API<input name="baseUrl" type="url" placeholder="https://api.exemplo.com/v1" value="${escapeHtml(flame.baseUrl || current.baseUrl || "")}"></label>
      <label>Modelo<input name="model" required autocomplete="off" value="${escapeHtml(flame.model || current.model || "")}" placeholder="nome-do-modelo"></label>
      <label>Chave de API<input name="apiKey" type="password" required autocomplete="off" placeholder="${flame.configured ? "Cole a chave de novo para trocar" : "sk-…"}"></label>
      <footer>${flame.configured ? '<button class="kz-btn is-danger" type="button" data-flame-remove>Remover</button>' : ""}<span></span><button class="kz-btn" type="button" data-flame-cancel>Cancelar</button><button class="kz-btn is-primary" type="submit">Validar e usar</button></footer>
    </form>`;
    document.body.append(modal);
    const form = $("form", modal);
    const sync = () => {
      const preset = presets.find((item) => item.id === form.provider.value);
      $("[data-base]", form).hidden = form.provider.value !== "custom";
      if (preset && form.provider.value !== "custom") { form.baseUrl.value = preset.baseUrl; if (!flame.configured || flame.provider !== preset.id) form.model.value = preset.model; }
    };
    form.provider.addEventListener("change", sync);
    sync();
    const close = () => modal.remove();
    $(".kz-flame-backdrop", modal).addEventListener("click", close);
    $("[data-flame-cancel]", modal).addEventListener("click", close);
    $("[data-flame-remove]", modal)?.addEventListener("click", async () => {
      try { await api("/api/models", { method: "DELETE" }); toast("Flame API removida."); } catch (error) { toast(error.message); }
      window.kazerModel = "kz";
      store.set("kazer-model", "kz");
      close();
      loadFlame();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("[type=submit]", form);
      button.disabled = true;
      button.textContent = "Validando…";
      try {
        await api("/api/models", { method: "POST", body: JSON.stringify({ provider: form.provider.value, baseUrl: form.baseUrl.value, model: form.model.value, apiKey: form.apiKey.value }) });
        close();
        await loadFlame();
        setModel("flame");
      } catch (error) {
        toast(error.message);
        button.disabled = false;
        button.textContent = "Validar e usar";
      }
    });
    form.model.focus();
  }
  window.kazerOpenFlameConfig = openFlameConfig;
  renderPicker();
  window.setTimeout(loadFlame, 700);

  /* ── Tema claro/escuro com transição suave ─────────────────────────── */
  new MutationObserver(() => {
    document.documentElement.classList.add("kz-theme-switching");
    window.setTimeout(() => document.documentElement.classList.remove("kz-theme-switching"), 520);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.className = "kz-rail-btn kz-theme-toggle";
  themeButton.dataset.tip = "Tema claro/escuro";
  themeButton.setAttribute("aria-label", "Alternar tema claro ou escuro");
  const paintThemeIcon = () => {
    const light = document.documentElement.dataset.theme === "light";
    themeButton.innerHTML = light
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.2 15.3A8.2 8.2 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  };
  themeButton.addEventListener("click", () => {
    const select = document.getElementById("appearanceSelect");
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    if (select) { select.value = next; select.dispatchEvent(new Event("change", { bubbles: true })); }
    else document.documentElement.dataset.theme = next;
    paintThemeIcon();
  });
  paintThemeIcon();
  window.setTimeout(() => {
    const settings = document.querySelector('.kz-rail-btn[data-rail="settings"]');
    settings?.before(themeButton);
    paintThemeIcon();
  }, 0);

  /* ── Fontes da pesquisa (estilo motor de respostas) ────────────────── */
  const KIND_LABEL = { web: "Web", wiki: "Wikipédia", academic: "Acadêmico", discussion: "Discussão", code: "Código", news: "Notícia", video: "Vídeo" };
  window.kazerRenderSources = (row, sources, { mode, upgrade } = {}) => {
    const host = (uri) => { try { return new URL(uri).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const box = document.createElement("section");
    box.className = "kz-sources";
    const kinds = [...new Set(sources.map((source) => source.kind || "web"))];
    box.innerHTML = `<header><strong>Fontes</strong><span>${sources.length} · ${kinds.map((kind) => KIND_LABEL[kind] || kind).join(" · ")}</span>${mode === "quality" ? '<em class="kz-badge-pro">Pesquisa a fundo</em>' : ""}</header><div class="kz-sources-row">${sources.slice(0, 12).map((source, index) => `<a class="kz-source" href="${escapeHtml(source.uri)}" target="_blank" rel="noopener noreferrer" style="--kz-li:${index}"><span class="kz-source-top"><i>${escapeHtml((host(source.uri)[0] || "?").toUpperCase())}</i><span>${escapeHtml(source.site || host(source.uri))}</span><b>${index + 1}</b></span><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(KIND_LABEL[source.kind] || "Web")}${source.year ? ` · ${escapeHtml(source.year)}` : ""}</small></a>`).join("")}</div>${upgrade ? '<p class="kz-sources-upsell">Você está no Free: a pesquisa usa o modo equilibrado. <button type="button">O Pro pesquisa a fundo →</button></p>' : ""}`;
    box.querySelector(".kz-sources-upsell button")?.addEventListener("click", () => window.kazerOpenPlans?.());
    (row.querySelector(".assistant-response") || row).prepend(box);
  };

  /* ── Widgets (clima, cálculo, cotação) ─────────────────────────────── */
  const sparkline = (values) => {
    if (!values?.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 200},${48 - ((value - min) / Math.max(0.0001, max - min)) * 44}`).join(" ");
    return `<svg viewBox="0 0 200 50" preserveAspectRatio="none" class="kz-spark"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  };
  window.kazerRenderWidgets = (row, widgets) => {
    const wrap = document.createElement("div");
    wrap.className = "kz-widgets";
    wrap.innerHTML = widgets.map((widget) => {
      if (widget.type === "weather") return `<article class="kz-widget is-weather"><header><span>${escapeHtml(widget.place)}</span><small>${escapeHtml(widget.source)}</small></header><div class="kz-weather-now"><strong>${Math.round(widget.current.temperature)}°</strong><span>${escapeHtml(widget.current.condition)}<small>Sensação ${Math.round(widget.current.feelsLike)}° · Umidade ${widget.current.humidity}% · Vento ${Math.round(widget.current.wind)} km/h</small></span></div><ol>${widget.daily.map((day) => `<li><span>${escapeHtml(new Date(`${day.day}T12:00`).toLocaleDateString("pt-BR", { weekday: "short" }))}</span><b>${Math.round(day.max)}°</b><small>${Math.round(day.min)}°</small></li>`).join("")}</ol></article>`;
      if (widget.type === "calculation") return `<article class="kz-widget is-calc"><small>${escapeHtml(widget.expression)} =</small><strong>${escapeHtml(Number(widget.result).toLocaleString("pt-BR", { maximumFractionDigits: 10 }))}</strong></article>`;
      if (widget.type === "stock") {
        const change = widget.previousClose ? ((widget.price - widget.previousClose) / widget.previousClose) * 100 : 0;
        return `<article class="kz-widget is-stock ${change >= 0 ? "is-up" : "is-down"}"><header><span>${escapeHtml(widget.symbol)}</span><small>${escapeHtml(widget.source)}</small></header><div><strong>${escapeHtml(Number(widget.price).toLocaleString("pt-BR", { style: "currency", currency: widget.currency || "BRL" }))}</strong><em>${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}% no mês</em></div>${sparkline(widget.series)}</article>`;
      }
      return "";
    }).join("");
    if (wrap.innerHTML.trim()) (row.querySelector(".assistant-response") || row).prepend(wrap);
  };

  /* ── ZIP (sem compressão, sem dependências) ────────────────────────── */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  function createZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const file of files) {
      const name = encoder.encode(file.path);
      const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true); entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((total, part) => total + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  window.kazerCreateZip = createZip;

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  window.kazerDownload = download;

  /* ── Projetos de arquivos com prévia ───────────────────────────────── */
  const safePath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((part) => part && part !== "." && part !== "..").join("/").slice(0, 180) || "arquivo.txt";
  const extOf = (path) => (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "txt";
  const FILE_ICON = { html: "◇", css: "◈", js: "◆", ts: "◆", json: "{ }", md: "¶", py: "◆", svg: "◇", txt: "≡", gd: "◆", tscn: "◇", godot: "◇" };

  function buildPreview(files) {
    const byPath = new Map(files.map((file) => [file.path.toLowerCase(), file]));
    const entry = byPath.get("index.html") || files.find((file) => extOf(file.path) === "html");
    if (!entry) return null;
    const base = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1) : "";
    const resolve = (href) => safePath(`${base}${String(href).replace(/^\.\//, "")}`).toLowerCase();
    let html = entry.content
      .replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (match, href) => { const file = byPath.get(resolve(href)); return file ? `<style>\n${file.content.replace(/<\/style/gi, "<\\/style")}\n</style>` : match; })
      .replace(/<script\b([^>]*)src=["']([^"']+\.m?js)["']([^>]*)><\/script>/gi, (match, before, src, after) => { const file = byPath.get(resolve(src)); return file ? `<script${before}${after}>\n${file.content.replace(/<\/script/gi, "<\\/script")}\n</script>` : match; });
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${csp}`) : `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
    return html;
  }

  window.kazerRenderProject = (rawFiles, { writing = false } = {}) => {
    const files = [];
    rawFiles.forEach((file) => {
      const path = safePath(file.path);
      const existing = files.find((item) => item.path === path);
      if (existing) existing.content = file.content; else files.push({ path, content: String(file.content || "") });
    });
    const card = document.createElement("section");
    card.className = "kz-project";
    const preview = buildPreview(files);
    const name = (files.find((file) => /readme/i.test(file.path))?.content.match(/^#\s+(.+)/m)?.[1] || "projeto-kazer").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "projeto-kazer";
    const totalBytes = files.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0);
    card.innerHTML = `<header class="kz-project-head"><span class="kz-project-icon">⧉</span><div><strong>${escapeHtml(name)}</strong><small>${files.length} arquivo${files.length === 1 ? "" : "s"} · ${(totalBytes / 1024).toFixed(1)} KB${writing ? " · escrevendo…" : ""}</small></div><div class="kz-project-actions">${preview ? '<button class="kz-btn" type="button" data-tab="preview" aria-pressed="true">Prévia</button>' : ""}<button class="kz-btn" type="button" data-tab="code" aria-pressed="${preview ? "false" : "true"}">Código</button><button class="kz-btn is-primary" type="button" data-zip ${writing ? "disabled" : ""}>Baixar .zip</button></div></header>
      <div class="kz-project-body"><nav class="kz-project-tree">${files.map((file, index) => `<button type="button" data-file="${index}" class="${index === 0 ? "is-active" : ""}" style="--kz-li:${index}"><i>${FILE_ICON[extOf(file.path)] || "≡"}</i><span>${escapeHtml(file.path)}</span></button>`).join("")}</nav>
      <div class="kz-project-view">${preview ? '<div class="kz-project-preview"><iframe sandbox="allow-scripts allow-modals" title="Prévia do projeto" loading="lazy"></iframe><button class="kz-project-expand" type="button" aria-label="Expandir prévia">⤢</button></div>' : ""}<div class="kz-project-code" ${preview ? "hidden" : ""}><header><span data-current></span><button class="kz-btn" type="button" data-copy>Copiar</button><button class="kz-btn" type="button" data-save>Baixar arquivo</button></header><pre><code></code></pre></div></div></div>`;
    let current = 0;
    const show = (index) => {
      current = index;
      card.querySelectorAll("[data-file]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.file) === index));
      $("[data-current]", card).textContent = files[index]?.path || "";
      $(".kz-project-code code", card).textContent = files[index]?.content || "";
    };
    const tab = (name) => {
      card.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tab === name)));
      const previewBox = $(".kz-project-preview", card);
      if (previewBox) previewBox.hidden = name !== "preview";
      $(".kz-project-code", card).hidden = name !== "code";
    };
    show(0);
    if (preview && !writing) { const frame = $("iframe", card); frame.srcdoc = preview; }
    card.addEventListener("click", (event) => {
      const fileButton = event.target.closest("[data-file]");
      if (fileButton) { show(Number(fileButton.dataset.file)); tab("code"); return; }
      const tabButton = event.target.closest("[data-tab]");
      if (tabButton) { tab(tabButton.dataset.tab); return; }
      if (event.target.closest("[data-zip]")) { download(createZip(files), `${name}.zip`); toast(`${name}.zip baixado`); return; }
      if (event.target.closest("[data-copy]")) { navigator.clipboard?.writeText(files[current].content).then(() => toast("Copiado")); return; }
      if (event.target.closest("[data-save]")) { download(new Blob([files[current].content], { type: "text/plain;charset=utf-8" }), files[current].path.split("/").pop()); return; }
      if (event.target.closest(".kz-project-expand")) card.classList.toggle("is-expanded");
    });
    return card;
  };
})();
