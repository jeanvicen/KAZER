/*
 * KAZER App — telas no padrão de apps de resposta (referência: Perplexity
 * mobile): fundo vivo no início (some ao conversar), gaveta de Sessões,
 * Configurações em lista, tela do Pro e Conectores em folha inferior.
 * Reaproveita os controles e dados já existentes em chat.html.
 */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const app = $("#app");
  const html = document.documentElement;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (message) => window.kazerShowToast?.(message);
  const store = {
    get(key, fallback) { try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };
  const isMobile = () => window.matchMedia("(max-width: 1079px)").matches;
  const I = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/></svg>',
    computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/></svg>',
    engine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>',
    memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.9.8A4 4 0 0 0 4 12a4 4 0 0 0 3 6.9A3 3 0 0 0 12 19Z"/><path d="M12 5a3 3 0 1 1 5.9.8A4 4 0 0 1 20 12a4 4 0 0 1-3 6.9A3 3 0 0 1 12 19Z"/></svg>',
    docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h7l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v6h6M4 7v12a2 2 0 0 0 2 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
    checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M5 17h14l-2-5V5h1V3H6v2h1v7Z"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  /* ── Fundo vivo (some quando a conversa começa) ─────────────────────── */
  const live = document.createElement("div");
  live.className = "kz-live";
  live.setAttribute("aria-hidden", "true");
  live.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
  document.body.prepend(live);
  const liveEnabled = () => store.get("kazer-live-bg", true) !== false;
  const syncLive = () => {
    const conversing = app?.classList.contains("in-conversation");
    html.classList.toggle("kz-conversing", Boolean(conversing));
    html.classList.toggle("kz-live-off", !liveEnabled());
  };
  if (app) new MutationObserver(syncLive).observe(app, { attributes: true, attributeFilter: ["class"] });
  syncLive();

  /* ── Início no celular: upgrade, marca e "Atualizado recentemente" ──── */
  const relative = (value) => {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "Agora mesmo";
    if (minutes < 60) return `${minutes} min atrás`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h atrás`;
    const days = Math.round(hours / 24);
    return days === 1 ? "ontem" : `${days} dias atrás`;
  };
  const sessions = () => (window.kazerHistory?.list?.() || []).filter((item) => !item.archived);

  const homeTop = document.createElement("div");
  homeTop.className = "kz-home-top";
  homeTop.innerHTML = `<button class="kz-upgrade-pill" type="button">${I.up}<span>Fazer upgrade para o KAZER Pro</span>${I.chevron}</button>`;
  homeTop.querySelector("button").addEventListener("click", () => openPaywall());
  const recent = document.createElement("section");
  recent.className = "kz-recent";
  const greeting = $("#newChatGreeting");
  greeting?.before(homeTop);
  $("#emptyState")?.append(recent);

  function renderRecent() {
    const items = sessions().slice(0, 3);
    recent.hidden = !items.length;
    recent.innerHTML = items.length ? `<h3>Atualizado recentemente</h3>${items.map((item, index) => `<div class="kz-recent-row" style="--i:${index}"><button type="button" class="kz-recent-open" data-open="${esc(item.id)}"><span class="kz-recent-mark">${I.checkCircle}</span><strong>${esc(item.title)}</strong><time>${esc(relative(item.updatedAt || item.createdAt))}</time></button><button type="button" class="kz-dots" data-menu="${esc(item.id)}" aria-label="Opções">${I.dots}</button></div>`).join("")}` : "";
  }
  recent.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) { window.kazerHistory?.open(open.dataset.open); return; }
    const menu = event.target.closest("[data-menu]");
    if (menu) openSessionMenu(menu, menu.dataset.menu);
  });

  /* ── Menu de sessão (Fixar, Arquivar, Excluir) ──────────────────────── */
  let openMenu = null;
  function openSessionMenu(anchor, id) {
    openMenu?.remove();
    const item = (window.kazerHistory?.list?.() || []).find((entry) => entry.id === id);
    if (!item) return;
    const menu = document.createElement("div");
    menu.className = "kz-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<button type="button" data-act="pin">${I.pin}<span>${item.pinned ? "Desafixar" : "Fixar"}</span></button><button type="button" data-act="archive">${I.archive}<span>${item.archived ? "Desarquivar" : "Arquivar"}</span></button><button type="button" data-act="delete" class="is-danger">${I.trash}<span>Excluir</span></button>`;
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - menu.offsetHeight - 12, rect.bottom + 6);
    menu.style.top = `${Math.max(12, top)}px`;
    menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    openMenu = menu;
    menu.addEventListener("click", (event) => {
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "pin") window.kazerHistory.update(id, { pinned: !item.pinned });
      if (act === "archive") { window.kazerHistory.update(id, { archived: !item.archived }); toast(item.archived ? "Sessão restaurada" : "Sessão arquivada"); }
      if (act === "delete") { window.kazerHistory.remove(id); toast("Sessão excluída"); }
      menu.remove();
      openMenu = null;
      renderAll();
    });
  }
  document.addEventListener("click", (event) => { if (openMenu && !event.target.closest(".kz-menu") && !event.target.closest("[data-menu]")) { openMenu.remove(); openMenu = null; } }, true);

  /* ── Gaveta: Sessões ────────────────────────────────────────────────── */
  const drawer = document.createElement("section");
  drawer.className = "kz-drawer";
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Menu e sessões");
  drawer.innerHTML = `<header class="kz-drawer-head"><button class="kz-round" type="button" data-settings aria-label="Configurações">${I.gear}</button><strong data-name>KAZER</strong><button class="kz-round" type="button" data-search aria-label="Buscar sessões">${I.search}</button><button class="kz-round" type="button" data-close aria-label="Voltar ao chat">${I.arrow}</button></header>
    <label class="kz-drawer-search" hidden>${I.search}<input type="search" placeholder="Buscar sessões" autocomplete="off"></label>
    <nav class="kz-drawer-nav"><button type="button" data-go="connectors">${I.plug}<span>Conectores</span></button><button type="button" data-go="computer">${I.computer}<span>Computer</span></button><button type="button" data-go="memory">${I.memory}<span>Memórias</span></button><button type="button" data-go="docs">${I.docs}<span>Documentos</span></button></nav>
    <div class="kz-drawer-sessions"><div class="kz-sessions-head"><h3>Sessões</h3><label class="kz-filter"><select aria-label="Filtrar sessões"><option value="all">Tudo</option><option value="pinned">Fixadas</option><option value="archived">Arquivadas</option></select>${I.down}</label></div><ol class="kz-sessions"></ol></div>
    <button class="kz-fab" type="button" data-new aria-label="Nova conversa">${I.plus}</button>`;
  document.body.append(drawer);
  const sessionList = $(".kz-sessions", drawer);
  const filterSelect = $(".kz-filter select", drawer);
  const searchInput = $(".kz-drawer-search input", drawer);

  function renderDrawer() {
    $("[data-name]", drawer).textContent = window.kazerAccount?.().name || "KAZER";
    const all = window.kazerHistory?.list?.() || [];
    const query = searchInput.value.trim().toLowerCase();
    const filter = filterSelect.value;
    const items = all
      .filter((item) => (filter === "archived" ? item.archived : !item.archived) && (filter !== "pinned" || item.pinned))
      .filter((item) => !query || String(item.title).toLowerCase().includes(query))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    sessionList.innerHTML = items.length
      ? items.map((item, index) => `<li style="--i:${Math.min(index, 12)}"><button type="button" class="kz-session" data-open="${esc(item.id)}">${item.pinned ? `<i class="kz-pin">${I.pin}</i>` : ""}<strong>${esc(item.title)}</strong><time>${esc(relative(item.updatedAt || item.createdAt))}</time></button><button type="button" class="kz-dots" data-menu="${esc(item.id)}" aria-label="Opções da sessão">${I.dots}</button></li>`).join("")
      : `<li class="kz-sessions-empty">${query ? "Nenhuma sessão encontrada." : filter === "archived" ? "Nada arquivado." : "Suas conversas aparecem aqui."}</li>`;
  }

  function openDrawer() {
    renderDrawer();
    drawer.hidden = false;
    html.classList.add("kz-drawer-open");
  }
  function closeDrawer({ back = true } = {}) {
    drawer.hidden = true;
    html.classList.remove("kz-drawer-open");
    if (back && app?.classList.contains("history-active")) $("#historyExitAction")?.click();
  }
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) return closeDrawer();
    if (event.target.closest("[data-settings]")) { closeDrawer(); return openSettings(); }
    if (event.target.closest("[data-search]")) { const box = $(".kz-drawer-search", drawer); box.hidden = !box.hidden; if (!box.hidden) searchInput.focus(); return; }
    if (event.target.closest("[data-new]")) { window.location.href = "?view=chat"; return; }
    const open = event.target.closest("[data-open]");
    if (open) { closeDrawer({ back: false }); window.kazerHistory?.open(open.dataset.open); return; }
    const menu = event.target.closest("[data-menu]");
    if (menu) return openSessionMenu(menu, menu.dataset.menu);
    const go = event.target.closest("[data-go]")?.dataset.go;
    if (!go) return;
    closeDrawer();
    if (go === "connectors") window.setTimeout(() => window.kazerOpenConnectors?.(), 120);
    if (go === "computer") window.kazerSetMode?.("computer");
    if (go === "memory") window.setTimeout(() => $("#memoryOpenButton")?.click(), 120);
    if (go === "docs") window.location.href = "/documentos";
  });
  filterSelect.addEventListener("change", renderDrawer);
  searchInput.addEventListener("input", renderDrawer);

  // O botão de menu (≡) e a rota ?view=history abrem a gaveta no celular.
  const syncHistoryView = () => {
    if (isMobile() && app?.classList.contains("history-active")) { if (drawer.hidden) openDrawer(); }
    else if (!drawer.hidden && !app?.classList.contains("history-active") && isMobile()) closeDrawer({ back: false });
  };
  if (app) new MutationObserver(syncHistoryView).observe(app, { attributes: true, attributeFilter: ["class"] });

  /* ── Configurações em lista ─────────────────────────────────────────── */
  const settings = document.createElement("section");
  settings.className = "kz-sheet-screen kz-settings";
  settings.hidden = true;
  settings.setAttribute("aria-label", "Configurações");
  document.body.append(settings);
  const ariaOn = (element) => element?.getAttribute("aria-checked") === "true" || element?.getAttribute("aria-pressed") === "true" || element?.classList.contains("active") || element?.classList.contains("on");
  const THEME_LABEL = { dark: "Escuro", light: "Claro", system: "Padrão do sistema" };
  const LANG_LABEL = () => $("#languageSelect")?.selectedOptions?.[0]?.textContent || "Português (Brasil)";

  function renderSettings() {
    const account = window.kazerAccount?.() || { name: "KAZER", email: "" };
    const pro = app?.classList.contains("kz-is-pro");
    const theme = $("#appearanceSelect")?.value || "dark";
    const model = window.kazerModel === "flame" ? "Flame API (sua chave)" : "K.z 1.1";
    const row = (act, title, sub = "", extra = "") => `<button type="button" class="kz-row" data-act="${act}"><span><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ""}</span>${extra}</button>`;
    const toggle = (act, title, sub, on) => `<button type="button" class="kz-row" data-act="${act}" role="switch" aria-checked="${on}"><span><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ""}</span><i class="kz-switch${on ? " is-on" : ""}"></i></button>`;
    settings.innerHTML = `<header class="kz-sheet-head"><button class="kz-round" type="button" data-act="close" aria-label="Fechar">${I.close}</button><h2>Configurações</h2></header>
      <div class="kz-sheet-body">
        ${pro ? "" : `<article class="kz-pro-hero"><div class="kz-pro-hero-bg"><i></i><i></i><i></i></div><p class="kz-pro-word">kazer <span>pro</span></p><p>Desbloqueie a pesquisa a fundo, 10× mais uso e prioridade no Computer.</p><button type="button" data-act="pro">Adquira Pro ${I.arrow}</button></article>`}
        <h4>Conta</h4>
        <button type="button" class="kz-row kz-account" data-act="account"><span class="kz-avatar">${account.avatar ? `<img src="${esc(account.avatar)}" alt="" referrerpolicy="no-referrer">` : I.user}</span><span><strong>${esc(account.name)}</strong><small>${esc(account.email)}</small><em>Gerenciar conta</em></span>${I.chevron}</button>
        ${row("usage", "Uso do plano", pro ? "KAZER Pro ativo" : "Plano Free · veja quanto já usou")}
        ${toggle("private", "Modo privado", "Não usa nem grava memórias nesta sessão.", ariaOn($("#memoryPrivateSwitch")))}
        ${toggle("notifications", "Notificações", "Avisos e confirmações dentro do KAZER.", ariaOn($("#notificationsSwitch")))}
        <h4>Assistente</h4>
        ${row("model", "Modelo", model)}
        ${row("language", "Idioma", esc(LANG_LABEL()))}
        ${row("connectors", "Conectores", "GitHub, Vercel e MCP")}
        ${row("memory", "Memórias", "O que o KAZER lembra de você")}
        <h4>Aparência</h4>
        ${row("theme", "Tema", THEME_LABEL[theme] || "Escuro")}
        ${toggle("live", "Fundo vivo", "Animação de cor na tela inicial; some ao conversar.", liveEnabled())}
        <h4>Dados e segurança</h4>
        ${row("clear", "Limpar preferências locais", "Remove dados salvos neste navegador.")}
        <h4>Mais</h4>
        ${row("privacy", "Política de privacidade")}
        ${row("terms", "Termos de uso")}
        <button type="button" class="kz-row is-danger" data-act="logout"><span><strong>Sair</strong></span></button>
        <div class="kz-version"><strong>Versão do app</strong><small>KAZER · K.z 1.1</small></div>
      </div>`;
  }
  function openSettings() {
    renderSettings();
    settings.hidden = false;
    html.classList.add("kz-screen-open");
  }
  function closeSettings() { settings.hidden = true; html.classList.remove("kz-screen-open"); }
  settings.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const later = (fn) => { closeSettings(); window.setTimeout(fn, 140); };
    switch (act) {
      case "close": return closeSettings();
      case "pro": closeSettings(); return openPaywall();
      case "account": return later(() => window.kazerOpenAccount?.());
      case "usage": return later(() => $("#settingsUsageToggle")?.click());
      case "private": $("#memoryPrivateSwitch")?.click(); return window.setTimeout(renderSettings, 60);
      case "notifications": $("#notificationsSwitch")?.click(); return window.setTimeout(renderSettings, 60);
      case "model": return later(() => window.kazerOpenFlameConfig?.());
      case "language": return later(() => window.kazerOpenSettings?.("general"));
      case "connectors": return later(() => window.kazerOpenConnectors?.());
      case "memory": return later(() => $("#memoryOpenButton")?.click());
      case "theme": {
        const select = $("#appearanceSelect");
        if (select) { const order = ["dark", "light", "system"]; select.value = order[(order.indexOf(select.value) + 1) % order.length]; select.dispatchEvent(new Event("change", { bubbles: true })); }
        return renderSettings();
      }
      case "live": store.set("kazer-live-bg", !liveEnabled()); syncLive(); return renderSettings();
      case "clear": return later(() => $("#clearLocalData")?.click());
      case "privacy": window.location.href = "/documentos#privacidade"; return;
      case "terms": window.location.href = "/documentos#termos"; return;
      case "logout": return later(() => ($("#accountLogoutAction") || $("#settingsLogoutAction"))?.click());
      default: return;
    }
  });
  window.kazerOpenAppSettings = openSettings;
  // Todos os atalhos de configurações abrem a nova tela.
  ["#settingsAction", "#historySettingsAction", "#historyBrand"].forEach((selector) => {
    $(selector)?.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); openSettings(); }, true);
  });

  /* ── Tela do KAZER Pro ──────────────────────────────────────────────── */
  const paywall = document.createElement("section");
  paywall.className = "kz-sheet-screen kz-paywall";
  paywall.hidden = true;
  paywall.setAttribute("aria-label", "KAZER Pro");
  document.body.append(paywall);
  const prices = { monthly: 2990, yearly: 29900 };
  let cycle = "yearly";
  const money = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const FEATURES = [
    ["Chat e pesquisa", true, true],
    ["Modo Computer (GitHub e Vercel)", true, true],
    ["Pesquisa a fundo com todas as fontes", false, true],
    ["10× mais uso por mês", false, true],
    ["Prioridade no Computer e na Engine", false, true],
    ["Conectores sem limite", false, true],
    ["Novos recursos antes", false, true],
  ];
  function renderPaywall() {
    const saving = Math.max(0, Math.round((1 - prices.yearly / (prices.monthly * 12)) * 100));
    const mark = (on) => (on ? `<i class="is-on">${I.check}</i>` : "<i>–</i>");
    paywall.innerHTML = `<div class="kz-pay-glow" aria-hidden="true"><i></i><i></i></div>
      <header class="kz-pay-head"><button class="kz-round" type="button" data-act="close" aria-label="Fechar">${I.close}</button><button class="kz-link" type="button" data-act="restore">Restaurar</button></header>
      <div class="kz-pay-body">
        <h2>Pesquise a fundo.<br>Execute com o Computer.</h2>
        <div class="kz-marquee" aria-hidden="true"><div>${["K.z 1.1", "Pesquisa a fundo", "Computer", "KAZER Engine", "Flame API", "Conectores", "10× mais uso"].concat(["K.z 1.1", "Pesquisa a fundo", "Computer", "KAZER Engine", "Flame API", "Conectores", "10× mais uso"]).map((item) => `<span>${item}</span>`).join("")}</div></div>
        <div class="kz-compare"><div class="kz-compare-head"><span>Recurso</span><span>Free</span><span>Pro</span></div>${FEATURES.map(([name, free, pro], index) => `<div class="kz-compare-row" style="--i:${index}"><span>${name}</span>${mark(free)}${mark(pro)}</div>`).join("")}</div>
      </div>
      <footer class="kz-pay-foot">
        <div class="kz-plans">
          <button type="button" class="kz-plan${cycle === "monthly" ? " is-active" : ""}" data-cycle="monthly"><span>Mensal</span><strong>${money(prices.monthly)}</strong><small>/mês</small><em>${money(prices.monthly * 12)}/ano</em></button>
          <button type="button" class="kz-plan${cycle === "yearly" ? " is-active" : ""}" data-cycle="yearly"><span>Anual</span>${saving ? `<b>-${saving}%</b>` : ""}<strong>${money(prices.yearly)}</strong><small>/ano</small><em>${money(Math.round(prices.yearly / 12))}/mês</em></button>
        </div>
        <button type="button" class="kz-cta" data-act="buy">Adquira Pro</button>
        <p>PIX · ativa sozinho após a confirmação · sem renovação automática</p>
      </footer>`;
  }
  function openPaywall() {
    renderPaywall();
    paywall.hidden = false;
    html.classList.add("kz-screen-open");
    fetch("/api/billing/checkout", { headers: { Accept: "application/json" } }).then((response) => (response.ok ? response.json() : null)).then((data) => {
      (data?.cycles || []).forEach((item) => { if (item.amountCents) prices[item.cycle] = item.amountCents; });
      if (!paywall.hidden) renderPaywall();
    }).catch(() => {});
  }
  function closePaywall() { paywall.hidden = true; html.classList.remove("kz-screen-open"); }
  paywall.addEventListener("click", async (event) => {
    const plan = event.target.closest("[data-cycle]");
    if (plan) { cycle = plan.dataset.cycle; return renderPaywall(); }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "close") return closePaywall();
    if (act === "restore") { toast("Verificando sua assinatura…"); window.setTimeout(() => window.location.reload(), 600); return; }
    if (act !== "buy") return;
    if (app?.classList.contains("kz-is-pro")) { toast("Seu KAZER Pro já está ativo."); return; }
    const button = event.target.closest("[data-act]");
    button.disabled = true;
    button.textContent = "Abrindo pagamento…";
    try {
      const data = await window.kazerWorkspace.api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ cycle }) });
      if (data?.url && /^https:\/\//.test(data.url)) window.location.assign(data.url);
      else throw new Error("Não foi possível abrir o pagamento.");
    } catch (error) {
      toast(/em breve/i.test(error.message) ? "O pagamento do Pro abre em breve. Avisaremos você por aqui." : error.message);
      button.disabled = false;
      button.textContent = "Adquira Pro";
    }
  });
  window.kazerOpenPlans = openPaywall;

  /* ── Conectores: busca e filtros na folha ───────────────────────────── */
  const connectorsScreen = $("#connectorsScreen");
  if (connectorsScreen && !$(".kz-conn-tools", connectorsScreen)) {
    const tools = document.createElement("div");
    tools.className = "kz-conn-tools";
    tools.innerHTML = `<p>Conecte seus aplicativos e serviços para o KAZER ler no Chat e agir no Computer.</p><label class="kz-conn-search">${I.search}<input type="search" placeholder="Pesquisar conectores" autocomplete="off"></label><div class="kz-chips" role="tablist"><button type="button" class="is-active" data-filter="all">Todos</button><button type="button" data-filter="on">Conectados</button><button type="button" data-filter="off">Disponíveis</button></div>`;
    $(".connectors-head", connectorsScreen)?.after(tools);
    connectorsScreen.insertAdjacentHTML("afterbegin", '<span class="kz-sheet-handle" aria-hidden="true"></span>');
    let filter = "all";
    const apply = () => {
      const query = $("input", tools).value.trim().toLowerCase();
      $$(".kz-conn-card", connectorsScreen).forEach((card) => {
        const on = card.classList.contains("is-on");
        card.hidden = (filter === "on" && !on) || (filter === "off" && on) || (query && !card.textContent.toLowerCase().includes(query));
      });
    };
    $("input", tools).addEventListener("input", apply);
    tools.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-filter]");
      if (!chip) return;
      filter = chip.dataset.filter;
      $$("[data-filter]", tools).forEach((item) => item.classList.toggle("is-active", item === chip));
      apply();
    });
    window.addEventListener("kazer:connectors-changed", () => window.setTimeout(apply, 0));
  }

  /* ── Esc fecha a camada aberta ──────────────────────────────────────── */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!paywall.hidden) closePaywall();
    else if (!settings.hidden) closeSettings();
    else if (!drawer.hidden) closeDrawer();
  });

  function renderAll() { renderRecent(); if (!drawer.hidden) renderDrawer(); }
  window.addEventListener("storage", renderAll);
  window.setTimeout(() => { renderAll(); syncHistoryView(); }, 700);
  window.setInterval(() => { if (!app?.classList.contains("in-conversation")) renderRecent(); }, 30000);
})();
