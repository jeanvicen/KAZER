/*
 * KAZER Nova — comportamento da nova interface.
 * Logo 3D, trilho lateral, seletor Chat/Computer, conectores reais
 * (GitHub, Vercel, MCP personalizado), log de ações, animações de resposta
 * e checkout do KAZER Pro. Depende de chat.html e kazer-workspace.js.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $("#app");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (message) => window.kazerShowToast ? window.kazerShowToast(message) : console.info(message);
  const store = {
    get(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; } },
    set(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };
  const ws = () => window.kazerWorkspace;
  const api = (path, options) => ws()?.api ? ws().api(path, options) : Promise.reject(new Error("Sessão indisponível."));

  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
    computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4M7.5 9.5l2 1.5-2 1.5M12 12.5h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2Z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a9.5 9.5 0 0 0-3 18.51c.48.09.65-.21.65-.46v-1.7c-2.65.58-3.2-1.12-3.2-1.12-.44-1.1-1.06-1.4-1.06-1.4-.87-.6.07-.59.07-.59.96.07 1.47.99 1.47.99.85 1.46 2.22 1.04 2.76.8.09-.62.33-1.04.6-1.28-2.12-.24-4.35-1.06-4.35-4.72 0-1.04.37-1.9.98-2.57-.1-.24-.43-1.22.1-2.54 0 0 .8-.26 2.62.98A9.1 9.1 0 0 1 12 7.08a9 9 0 0 1 2.38.32c1.82-1.24 2.62-.98 2.62-.98.53 1.32.2 2.3.1 2.54.61.67.98 1.53.98 2.57 0 3.67-2.23 4.48-4.36 4.72.34.3.64.88.64 1.77v2.62c0 .25.17.55.65.46A9.5 9.5 0 0 0 12 2.5Z"/></svg>',
    vercel: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 22 20H2Z"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  };

  /* ── Logo 3D ───────────────────────────────────────────────────────── */
  let logoCount = 0;
  function alienSvg(uid) {
    return `<svg viewBox="0 0 240 240" aria-hidden="true"><defs><linearGradient id="kzs${uid}" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9ecec"/><stop offset="1" stop-color="#c3cacb"/></linearGradient><linearGradient id="kzp${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f7"/><stop offset="1" stop-color="#b7bfc0"/></linearGradient></defs><g stroke="#9BA8AB" stroke-opacity=".5" stroke-width="1.2"><path fill="url(#kzs${uid})" d="M120 14C166 14 197 46 197 90C197 132 162 162 120 170C78 162 43 132 43 90C43 46 74 14 120 14Z"/><path fill="url(#kzp${uid})" d="M14 150C40 151 64 157 80 168C86 178 88 190 86 201C64 196 38 192 16 190C12 176 12 162 14 150Z"/><path fill="url(#kzp${uid})" d="M226 150C200 151 176 157 160 168C154 178 152 190 154 201C176 196 202 192 224 190C228 176 228 162 226 150Z"/><path fill="url(#kzp${uid})" d="M70 196C102 212 138 212 170 196L172 214C140 232 100 232 68 214Z"/></g><path class="kz-eye" fill="#06141B" d="M60 94C80 84 106 100 111 128C90 131 64 120 60 94Z"/><path class="kz-eye" fill="#06141B" d="M180 94C160 84 134 100 129 128C150 131 176 120 180 94Z"/></svg>`;
  }

  function createLogo3D({ size, depth = 7, className = "" } = {}) {
    const uid = ++logoCount;
    const root = document.createElement("span");
    root.className = `kz-logo3d ${className}`.trim();
    if (size) root.style.setProperty("--size", typeof size === "number" ? `${size}px` : size);
    const layers = [];
    for (let index = depth; index >= 1; index -= 1) layers.push(`<span class="kz-logo3d-layer is-depth" style="--z:${-index * 1.6}">${alienSvg(`${uid}d${index}`)}</span>`);
    root.innerHTML = `<span class="kz-logo3d-glow"></span><span class="kz-logo3d-shadow"></span><span class="kz-logo3d-stage">${layers.join("")}<span class="kz-logo3d-layer" style="--z:0">${alienSvg(uid)}</span></span>`;
    return root;
  }
  window.kazerCreateLogo3D = createLogo3D;

  // Inclinação 3D seguindo o ponteiro (um único listener para todos os logos).
  if (!reduceMotion) {
    let frame = 0;
    let pointer = null;
    window.addEventListener("pointermove", (event) => {
      pointer = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        document.querySelectorAll(".kz-logo3d:not(.is-thinking)").forEach((logo) => {
          const rect = logo.getBoundingClientRect();
          if (!rect.width) return;
          const dx = (pointer.clientX - (rect.left + rect.width / 2)) / window.innerWidth;
          const dy = (pointer.clientY - (rect.top + rect.height / 2)) / window.innerHeight;
          logo.style.setProperty("--ry", `${Math.max(-28, Math.min(28, dx * 60))}deg`);
          logo.style.setProperty("--rx", `${Math.max(-22, Math.min(22, -dy * 50))}deg`);
        });
      });
    }, { passive: true });
  }

  /* ── Splash, favicon e herói ───────────────────────────────────────── */
  const splashBrand = $(".app-splash-brand");
  if (splashBrand && !$(".kz-logo3d", splashBrand)) splashBrand.prepend(createLogo3D({ className: "kz-splash-logo" }));

  const greeting = $("#newChatGreeting");
  if (greeting && !$(".kz-hero", greeting)) {
    const hero = document.createElement("div");
    hero.className = "kz-hero";
    hero.append(createLogo3D());
    greeting.prepend(hero);
  }

  function mountProBanner() {
    const dock = $(".composer-dock");
    if (!dock || $(".kz-pro-banner")) return;
    const banner = document.createElement("div");
    banner.className = "kz-pro-banner";
    banner.innerHTML = `<span><b>KAZER Pro</b> · 10× mais uso e o Computer editando seus repositórios e deploys.</span><button class="kz-btn is-primary kz-upgrade-cta" type="button">Ver o Pro</button>`;
    banner.querySelector("button").addEventListener("click", () => window.kazerOpenPlans?.());
    dock.append(banner);
  }
  mountProBanner();

  /* ── Trilho lateral ────────────────────────────────────────────────── */
  function buildRail() {
    if (!app || $(".kz-rail")) return;
    const rail = document.createElement("nav");
    rail.className = "kz-rail";
    rail.setAttribute("aria-label", "Navegação principal");
    const logo = document.createElement("button");
    logo.className = "kz-rail-logo";
    logo.type = "button";
    logo.setAttribute("aria-label", "Início");
    logo.append(createLogo3D({ size: 40, depth: 5 }));
    rail.append(logo);
    const button = (key, tip, icon, onClick, extra = "") => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `kz-rail-btn ${extra}`.trim();
      item.dataset.tip = tip;
      item.dataset.rail = key;
      item.setAttribute("aria-label", tip);
      item.innerHTML = icon;
      item.addEventListener("click", onClick);
      rail.append(item);
      return item;
    };
    const newChat = () => { window.location.href = "?view=chat"; };
    logo.addEventListener("click", newChat);
    button("new", "Nova conversa", ICONS.plus, newChat, "is-new");
    button("home", "Início", ICONS.home, newChat);
    button("history", "Histórico", ICONS.history, () => $("#desktopSidebarToggle")?.click());
    button("connectors", "Conectores", ICONS.plug, () => window.kazerOpenConnectors?.());
    button("computer", "Modo Computer", ICONS.computer, () => setMode(mode === "computer" ? "chat" : "computer"));
    const spacer = document.createElement("span");
    spacer.className = "kz-rail-spacer";
    rail.append(spacer);
    const pro = document.createElement("button");
    pro.type = "button";
    pro.className = "kz-rail-pro";
    pro.textContent = "PRO";
    pro.setAttribute("aria-label", "KAZER Pro");
    pro.addEventListener("click", () => window.kazerOpenPlans?.());
    rail.append(pro);
    button("settings", "Configurações", ICONS.settings, () => $("#settingsAction")?.click() || $("#historyBrand")?.click());
    app.prepend(rail);
  }
  buildRail();

  /* ── Modo Chat / Computer ──────────────────────────────────────────── */
  let mode = store.get("kazer-mode", "chat") === "computer" ? "computer" : "chat";
  const controls = $(".composer-controls");
  const attach = $("#attachButton");
  const modes = document.createElement("div");
  modes.className = "kz-modes";
  modes.setAttribute("role", "radiogroup");
  modes.setAttribute("aria-label", "Modo do KAZER");
  modes.innerHTML = `<span class="kz-mode-pill" aria-hidden="true"></span><button class="kz-mode" type="button" role="radio" data-mode="chat">${ICONS.chat}<span>Chat</span></button><button class="kz-mode" type="button" role="radio" data-mode="computer">${ICONS.computer}<span>Computer</span></button>`;
  const chips = document.createElement("div");
  chips.className = "kz-context-chips";
  if (controls && attach) attach.after(modes, chips);
  modes.addEventListener("click", (event) => {
    const target = event.target.closest("[data-mode]");
    if (target) setMode(target.dataset.mode, { announce: true });
  });

  function positionPill() {
    const active = modes.querySelector(`[data-mode="${mode}"]`);
    const pill = modes.querySelector(".kz-mode-pill");
    if (!active || !pill || !active.offsetWidth) return;
    pill.style.setProperty("--w", `${active.offsetWidth}px`);
    pill.style.setProperty("--x", `${active.offsetLeft - 3}px`);
  }

  function setMode(next, { announce = false } = {}) {
    mode = next === "computer" ? "computer" : "chat";
    window.kazerChatMode = mode;
    store.set("kazer-mode", mode);
    app?.classList.toggle("kz-mode-computer", mode === "computer");
    modes.querySelectorAll("[data-mode]").forEach((item) => item.setAttribute("aria-checked", String(item.dataset.mode === mode)));
    document.querySelector('.kz-rail-btn[data-rail="computer"]')?.classList.toggle("is-active", mode === "computer");
    const input = $("#messageInput");
    if (input) input.placeholder = mode === "computer" ? "Descreva uma tarefa — o KAZER executa no GitHub e na Vercel…" : "Pergunte qualquer coisa…";
    document.querySelectorAll(".kz-hero .kz-logo3d").forEach((logo) => logo.classList.toggle("is-computer", mode === "computer"));
    positionPill();
    renderChips();
    if (announce) {
      if (mode === "computer") toast(ws()?.state?.github?.connected ? "Modo Computer: o KAZER pode criar branches, commits, PRs e deploys." : "Modo Computer ligado. Conecte o GitHub em Conectores para editar repositórios.");
      else toast("Chat: o KAZER lê seus repositórios e projetos, sem alterar nada.");
    }
  }
  requestAnimationFrame(() => setMode(mode));
  window.addEventListener("resize", positionPill);
  window.kazerSetMode = setMode;

  /* ── Contexto (repositório e Vercel) ───────────────────────────────── */
  const vercel = { connection: { connected: false }, projects: [], loaded: false };
  const savedRepo = store.get("kazer-selected-repo");
  if (savedRepo?.fullName) window.kazerSelectedRepository = savedRepo;

  function renderChips() {
    const repo = window.kazerSelectedRepository;
    const parts = [];
    if (repo?.fullName) parts.push(`<button class="kz-chip is-readonly" type="button" data-chip="repo" title="Repositório em uso">${ICONS.github}<span>${escapeHtml(repo.fullName)}</span><span class="kz-chip-x" data-chip-clear aria-label="Remover repositório">×</span></button>`);
    if (vercel.connection.connected) parts.push(`<button class="kz-chip is-readonly" type="button" data-chip="vercel" title="Vercel conectada">${ICONS.vercel}<span>Vercel</span></button>`);
    chips.innerHTML = parts.join("");
  }
  chips.addEventListener("click", (event) => {
    if (event.target.closest("[data-chip-clear]")) {
      event.stopPropagation();
      selectRepo(null);
      return;
    }
    if (event.target.closest("[data-chip]")) window.kazerOpenConnectors?.();
  });

  function selectRepo(repo) {
    const value = repo ? { id: repo.id, name: repo.name, fullName: repo.fullName, htmlUrl: repo.htmlUrl, defaultBranch: repo.defaultBranch, language: repo.language, private: repo.private } : null;
    if (ws()?.selectRepository) ws().selectRepository(value);
    else window.kazerSelectedRepository = value;
    store.set("kazer-selected-repo", value);
    renderChips();
    renderConnectors();
  }

  async function loadVercel() {
    try {
      const data = await api("/api/vercel");
      vercel.connection = data.connection || { connected: false };
      vercel.projects = Array.isArray(data.projects) ? data.projects : [];
    } catch {
      vercel.connection = { connected: false };
      vercel.projects = [];
    }
    vercel.loaded = true;
    window.kazerVercelConnected = Boolean(vercel.connection.connected);
    renderChips();
    renderConnectors();
  }

  /* ── Tela de conectores ────────────────────────────────────────────── */
  const body = $("#connectorsBody");
  const exploreBody = $("#connectorsExploreScreen .connectors-body");
  const ui = { githubOpen: false, vercelForm: false, busy: "" };
  const REMOTE_HINTS = { Context7: "Documentação de bibliotecas", Figma: "Arquivos e frames de design", "Hugging Face": "Modelos e datasets", Linear: "Issues e projetos", Notion: "Páginas e bancos", Supabase: "Banco e projetos" };

  function iconFor(name) {
    if (typeof window.kazerConnectorIcon === "function") return window.kazerConnectorIcon(name);
    return ICONS.server;
  }

  function renderConnectors() {
    if (!body) return;
    const state = ws()?.state || { github: { connected: false }, repos: [], connectors: [] };
    const github = state.github || { connected: false };
    const selected = window.kazerSelectedRepository;
    const repos = Array.isArray(state.repos) ? state.repos : [];
    let index = 0;
    const card = (html, on) => `<article class="kz-conn-card${on ? " is-on" : ""}" style="--kz-li:${index++}">${html}</article>`;

    const githubCard = card(`<span class="kz-conn-icon">${ICONS.github}</span><div class="kz-conn-copy"><strong><span class="kz-dot"></span>GitHub</strong><small>${github.connected ? `Conectado como @${escapeHtml(github.login)}${selected?.fullName ? ` · usando ${escapeHtml(selected.fullName)}` : " · escolha um repositório"}` : "Leia código, commits e PRs. No Computer: branches, commits e PRs."}</small></div><div class="kz-conn-actions">${github.connected ? `<button class="kz-btn" type="button" data-act="gh-repos">${ui.githubOpen ? "Fechar" : "Repositórios"}</button><button class="kz-btn is-danger" type="button" data-act="gh-off" aria-label="Desconectar GitHub">Sair</button>` : `<button class="kz-btn is-primary" type="button" data-act="gh-on">Conectar</button>`}</div>${github.connected && ui.githubOpen ? `<div class="kz-conn-extra"><input class="kz-input" type="search" placeholder="Buscar repositório…" data-repo-search>${repos.length ? repos.map((repo) => `<button class="kz-repo${selected?.fullName === repo.fullName ? " is-selected" : ""}" type="button" data-repo="${escapeHtml(String(repo.id))}">${ICONS.github.replace("<svg", '<svg width="14" height="14"')}<span>${escapeHtml(repo.fullName)}</span><small>${repo.private ? "privado" : escapeHtml(repo.language || "")}</small></button>`).join("") : `<p class="kz-form" style="color:var(--kz-mist);font-size:12px">Carregando repositórios…</p>`}</div>` : ""}`, github.connected);

    const vc = vercel.connection;
    const vercelCard = card(`<span class="kz-conn-icon">${ICONS.vercel}</span><div class="kz-conn-copy"><strong><span class="kz-dot"></span>Vercel</strong><small>${vc.connected ? `Conectado como ${escapeHtml(vc.username)}${vc.expired ? " · token expirado" : ` · ${vercel.projects.length} projeto${vercel.projects.length === 1 ? "" : "s"}`}` : "Projetos, deploys e logs. No Computer: refazer deploy."}</small></div><div class="kz-conn-actions">${vc.connected ? `<button class="kz-btn is-danger" type="button" data-act="vc-off">Sair</button>` : `<button class="kz-btn is-primary" type="button" data-act="vc-form">${ui.vercelForm ? "Cancelar" : "Conectar"}</button>`}</div>${!vc.connected && ui.vercelForm ? `<form class="kz-form" data-vercel-form><p>Crie um token em <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener">vercel.com/account/tokens</a>. Ele é validado, cifrado e nunca volta para o navegador.</p><input class="kz-input" name="token" type="password" autocomplete="off" placeholder="Token da Vercel" required minlength="16"><input class="kz-input" name="teamId" autocomplete="off" placeholder="ID do time (opcional, team_…)"><button class="kz-btn is-primary" type="submit">Validar e conectar</button></form>` : ""}${vc.connected && vercel.projects.length ? `<div class="kz-conn-extra">${vercel.projects.slice(0, 8).map((project) => `<div class="kz-repo" role="note">${ICONS.vercel.replace("<svg", '<svg width="12" height="12"')}<span>${escapeHtml(project.name)}</span><small>${escapeHtml(project.state || project.framework || "")}</small></div>`).join("")}</div>` : ""}`, vc.connected);

    const mcp = (state.connectors || []).map((connector) => card(`<span class="kz-conn-icon">${iconFor(connector.name)}</span><div class="kz-conn-copy"><strong><span class="kz-dot"></span>${escapeHtml(connector.name)}</strong><small>${escapeHtml(connector.baseUrl || connector.command || "MCP")}${connector.type === "local" ? " · local não roda na nuvem" : ""}</small></div><div class="kz-conn-actions"><button class="kz-btn" type="button" data-act="mcp-toggle" data-id="${escapeHtml(connector.id)}">${connector.status === "connected" ? "Desligar" : "Ligar"}</button><button class="kz-btn is-danger" type="button" data-act="mcp-del" data-id="${escapeHtml(connector.id)}" aria-label="Excluir ${escapeHtml(connector.name)}">×</button></div>`, connector.status === "connected")).join("");

    body.innerHTML = `<div class="kz-mode-note">${ICONS.computer.replace("<svg", '<svg width="18" height="18" style="flex:0 0 auto"')}<span><b>Chat</b> lê repositórios, projetos e ferramentas sem alterar nada. <b>Computer</b> executa: cria branches, commits, pull requests e deploys — sempre fora da branch principal.</span></div><section class="kz-conn-section"><h3 class="kz-conn-title">Plataformas</h3>${githubCard}${vercelCard}</section><section class="kz-conn-section"><h3 class="kz-conn-title">Conectores MCP</h3>${mcp || `<p style="margin:0 2px 10px;color:var(--kz-mist);font-size:12.5px">Nenhum MCP ainda. Explore a galeria ou adicione o seu.</p>`}<div class="kz-conn-actions"><button class="kz-btn" type="button" data-act="explore">Explorar galeria</button><button class="kz-btn" type="button" data-act="custom">${ICONS.plus.replace("<svg", '<svg width="14" height="14"')}Personalizado</button></div></section>`;
  }

  function renderExplore() {
    if (!exploreBody) return;
    const presets = (ws()?.state?.presets || []).filter((preset) => preset.type === "remote");
    const list = [{ name: "GitHub", special: "github", hint: "Repositórios, PRs e issues" }, { name: "Vercel", special: "vercel", hint: "Projetos e deploys" }, ...presets.map((preset) => ({ ...preset, hint: REMOTE_HINTS[preset.name] || "MCP remoto" }))];
    exploreBody.innerHTML = `<div class="kz-catalog">${list.map((item, index) => `<button type="button" style="--kz-li:${index}" data-preset="${escapeHtml(item.name)}"><span class="kz-conn-icon">${item.special === "github" ? ICONS.github : item.special === "vercel" ? ICONS.vercel : iconFor(item.name)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.hint)}</small></button>`).join("")}</div>`;
  }

  exploreBody?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-preset]");
    if (!target) return;
    const name = target.dataset.preset;
    $("#connectorsExploreBack")?.click();
    if (name === "GitHub") return ws()?.connectGitHub?.();
    if (name === "Vercel") { ui.vercelForm = true; renderConnectors(); return; }
    const preset = (ws()?.state?.presets || []).find((item) => item.name === name);
    openCustom(preset);
  });

  body?.addEventListener("input", (event) => {
    if (!event.target.matches("[data-repo-search]")) return;
    const query = event.target.value.trim().toLowerCase();
    body.querySelectorAll("[data-repo]").forEach((item) => { item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query); });
  });

  body?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-vercel-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    submit.textContent = "Validando…";
    try {
      await api("/api/vercel", { method: "POST", body: JSON.stringify({ token: data.get("token"), teamId: data.get("teamId") }) });
      ui.vercelForm = false;
      toast("Vercel conectada ao KAZER");
      await loadVercel();
    } catch (error) {
      toast(error.message);
      submit.disabled = false;
      submit.textContent = "Validar e conectar";
    }
  });

  body?.addEventListener("click", async (event) => {
    const repoButton = event.target.closest("[data-repo]");
    if (repoButton) {
      const repo = (ws()?.state?.repos || []).find((item) => String(item.id) === repoButton.dataset.repo);
      if (repo) { selectRepo(repo); toast(`${repo.fullName} em uso · ${mode === "computer" ? "pode editar" : "somente leitura no Chat"}`); }
      return;
    }
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;
    if (act === "gh-on") return ws()?.connectGitHub?.();
    if (act === "gh-off") { await ws()?.disconnectGitHub?.(); return; }
    if (act === "gh-repos") { ui.githubOpen = !ui.githubOpen; renderConnectors(); if (ui.githubOpen) ws()?.refreshRepos?.(); return; }
    if (act === "vc-form") { ui.vercelForm = !ui.vercelForm; renderConnectors(); body.querySelector("[name=token]")?.focus(); return; }
    if (act === "vc-off") {
      if (!window.confirm("Desconectar a Vercel deste KAZER?")) return;
      try { await api("/api/vercel", { method: "DELETE" }); toast("Vercel desconectada"); } catch (error) { toast(error.message); }
      return loadVercel();
    }
    if (act === "explore") return $("#connectorsExploreAction")?.click();
    if (act === "custom") return openCustom();
    const id = target.dataset.id;
    const connector = (ws()?.state?.connectors || []).find((item) => item.id === id);
    if (!connector) return;
    target.disabled = true;
    try {
      if (act === "mcp-toggle") await api("/api/mcp", { method: "PATCH", body: JSON.stringify({ id, action: "toggle", status: connector.status === "connected" ? "disconnected" : "connected" }) });
      if (act === "mcp-del") {
        if (!window.confirm(`Excluir ${connector.name}?`)) { target.disabled = false; return; }
        await api(`/api/mcp?id=${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ id }) });
      }
      await ws()?.loadConnectors?.();
    } catch (error) { toast(error.message); target.disabled = false; }
  });

  /* Modal de conector personalizado (agora salva de verdade em /api/mcp). */
  const customModal = $("#connectorCustomModal");
  const customName = $("#connectorCustomName");
  const customUrl = $("#connectorCustomUrl");
  const customSubmit = $("#connectorCustomSubmit");
  const customOauth = $("#connectorCustomOauth");
  if (customUrl && !$("#connectorCustomToken")) {
    const field = document.createElement("label");
    field.className = "connector-custom-field";
    field.innerHTML = '<span>Token de acesso (opcional)</span><input type="password" id="connectorCustomToken" autocomplete="off" placeholder="Enviado como Authorization: Bearer" />';
    customUrl.closest("label")?.after(field);
  }
  if (customOauth && customOauth.checked) customOauth.checked = false;

  function openCustom(preset = null) {
    window.kazerOpenConnectorCustomModal?.();
    requestAnimationFrame(() => {
      if (preset) { customName.value = preset.name; customUrl.value = preset.baseUrl || ""; }
      if (customOauth) { customOauth.checked = false; customOauth.dispatchEvent(new Event("change")); }
      const token = $("#connectorCustomToken");
      if (token) token.value = "";
      customName.dispatchEvent(new Event("input"));
      (preset ? $("#connectorCustomToken") : customName)?.focus();
    });
  }

  customSubmit?.addEventListener("click", async (event) => {
    event.preventDefault();
    const name = customName.value.trim();
    const baseUrl = customUrl.value.trim();
    if (!name || !/^https:\/\//i.test(baseUrl)) { toast("Informe um nome e uma URL HTTPS."); return; }
    const token = $("#connectorCustomToken")?.value.trim() || "";
    const payload = {
      name,
      type: "remote",
      baseUrl,
      env: token ? { Authorization: /^bearer\s/i.test(token) ? token : `Bearer ${token}` } : {},
      oauthClientId: $("#connectorCustomClientId")?.value || "",
      oauthClientSecret: $("#connectorCustomClientSecret")?.value || "",
    };
    customSubmit.disabled = true;
    customSubmit.textContent = "Conectando…";
    try {
      await api("/api/mcp", { method: "POST", body: JSON.stringify(payload) });
      window.kazerCloseConnectorCustomModal?.();
      toast(`${name} conectado`);
      await ws()?.loadConnectors?.();
    } catch (error) {
      toast(error.message);
    } finally {
      customSubmit.disabled = false;
      customSubmit.textContent = "Adicionar";
    }
  });
  customModal?.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target.matches("input")) { event.preventDefault(); customSubmit?.click(); } });

  // Recarrega tudo ao abrir a tela de conectores.
  const connectorsScreen = $("#connectorsScreen");
  if (connectorsScreen) {
    new MutationObserver(() => {
      if (!connectorsScreen.hidden) {
        renderConnectors();
        ws()?.loadGitHubStatus?.();
        ws()?.loadConnectors?.();
        loadVercel();
      }
    }).observe(connectorsScreen, { attributes: true, attributeFilter: ["hidden"] });
  }
  const exploreScreen = $("#connectorsExploreScreen");
  if (exploreScreen) new MutationObserver(() => { if (!exploreScreen.hidden) renderExplore(); }).observe(exploreScreen, { attributes: true, attributeFilter: ["hidden"] });

  window.addEventListener("kazer:connectors-changed", () => { renderConnectors(); renderChips(); renderExplore(); });
  window.addEventListener("kazer:repo-selected", renderChips);

  /* ── Pensando / Computer ───────────────────────────────────────────── */
  window.kazerDecorateThinking = (row, { mode: runMode = "chat", repo = null } = {}) => {
    const thinking = row.querySelector(".thinking-row");
    if (!thinking) return;
    thinking.classList.add("kz-has-alien");
    const holder = document.createElement("span");
    holder.className = "kz-thinking-alien";
    holder.append(createLogo3D({ size: 40, depth: 4, className: `is-thinking${runMode === "computer" ? " is-computer" : ""}` }));
    thinking.prepend(holder);
    if (runMode !== "computer") return;
    const panel = document.createElement("div");
    panel.className = "kz-computer-run";
    const steps = ["Entendendo a tarefa", repo?.fullName ? `Abrindo ${repo.fullName}` : "Preparando o ambiente", "Planejando as alterações", "Executando ferramentas", "Revisando o resultado"];
    panel.innerHTML = `<div class="kz-computer-head">${ICONS.computer.replace("<svg", '<svg width="18" height="18"')}<span>KAZER Computer <small>· trabalhando</small></span></div><ol class="kz-computer-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`;
    thinking.after(panel);
    const items = [...panel.querySelectorAll("li")];
    let step = 0;
    const advance = () => {
      if (!panel.isConnected) return;
      items.forEach((item, index) => { item.classList.toggle("is-done", index < step); item.classList.toggle("is-on", index === step); });
      if (step < items.length - 1) { step += 1; window.setTimeout(advance, 2600 + step * 900); }
    };
    // A linha ainda não está no DOM quando é decorada.
    window.setTimeout(advance, 60);
  };

  window.kazerRenderActions = (row, actions, runMode) => {
    const content = row.querySelector(".assistant-response") || row;
    const details = document.createElement("details");
    details.className = "kz-actions";
    if (runMode === "computer") details.open = true;
    const errors = actions.filter((action) => action.state === "error").length;
    details.innerHTML = `<summary>${ICONS.computer.replace("<svg", '<svg width="16" height="16"')}<span>${actions.length} ${actions.length === 1 ? "ação" : "ações"}${errors ? ` · ${errors} com erro` : ""}</span><span class="kz-badge${runMode === "computer" ? "" : " is-chat"}">${runMode === "computer" ? "COMPUTER" : "SOMENTE LEITURA"}</span></summary><ol>${actions.map((action, index) => `<li class="${action.state === "error" ? "is-error" : ""}" style="--kz-li:${index}"><i>${action.state === "error" ? "!" : "✓"}</i><span><b>${escapeHtml(action.label)}</b>${action.target ? ` <code>${escapeHtml(action.target)}</code>` : ""}</span></li>`).join("")}</ol>`;
    content.prepend(details);
  };

  /* ── Revelação animada por tipo de bloco ───────────────────────────── */
  const MAX_ANIMATED_WORDS = 900;
  function wrapWords(element, startDelay, counter) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.parentElement?.closest("code, pre, svg, .kz-word") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const parts = node.textContent.split(/(\s+)/);
      if (parts.length < 2 && !node.textContent.trim()) return;
      const fragment = document.createDocumentFragment();
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { fragment.append(part); return; }
        const span = document.createElement("span");
        span.className = "kz-word";
        span.style.setProperty("--kz-d", `${startDelay}ms`);
        span.style.setProperty("--kz-w", String(counter.value++));
        span.textContent = part;
        fragment.append(span);
      });
      node.replaceWith(fragment);
    });
  }

  function blockType(element) {
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "UL" || tag === "OL") return "list";
    if (tag === "BLOCKQUOTE") return "quote";
    if (tag === "HR") return "rule";
    if (tag === "PRE" || element.classList.contains("code-block")) return "code";
    if (tag === "TABLE" || element.querySelector?.(":scope > table, table")) return "table";
    if (element.classList.contains("visual-block") || tag === "IMG" || tag === "FIGURE" || tag === "svg") return "visual";
    return "text";
  }

  window.kazerAnimateReveal = (content) => {
    if (reduceMotion || !content) return 0;
    const blocks = [...content.children];
    if (!blocks.length) return 0;
    const totalWords = (content.textContent || "").split(/\s+/).length;
    const animateWords = totalWords <= MAX_ANIMATED_WORDS;
    content.classList.add("kz-reveal");
    let delay = 0;
    const counter = { value: 0 };
    blocks.forEach((block) => {
      const type = blockType(block);
      block.classList.add("kz-in", `kz-in--${type}`);
      block.style.setProperty("--kz-d", `${delay}ms`);
      if (type === "list") [...block.children].forEach((item, index) => item.style.setProperty("--kz-li", String(index)));
      if (type === "table") block.querySelectorAll("tr").forEach((item, index) => item.style.setProperty("--kz-li", String(Math.min(index, 20))));
      if (animateWords && (type === "text" || type === "list" || type === "quote")) {
        const before = counter.value;
        counter.value = 0;
        wrapWords(block, delay, counter);
        const words = counter.value;
        counter.value = before;
        delay += Math.min(900, words * 14) + 60;
      } else {
        delay += type === "code" || type === "visual" ? 260 : 120;
      }
    });
    window.setTimeout(() => {
      content.classList.remove("kz-reveal");
      blocks.forEach((block) => block.classList.remove("kz-in", `kz-in--${blockType(block)}`));
      content.querySelectorAll(".kz-word").forEach((span) => span.replaceWith(span.textContent));
      content.normalize();
    }, delay + 1200);
    return Math.min(2600, delay + 400);
  };

  /* ── KAZER Pro: preços e checkout PIX ──────────────────────────────── */
  const proCard = $("#planProCard");
  const proButton = $("#plansProAction");
  let cycle = "monthly";
  const prices = { monthly: 2990, yearly: 29900 };
  const money = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function renderPrice() {
    const target = proCard?.querySelector(".kz-price");
    if (!target) return;
    const monthlyEquivalent = cycle === "yearly" ? Math.round(prices.yearly / 12) : prices.monthly;
    target.innerHTML = `<strong>${money(monthlyEquivalent)}</strong><span>/mês${cycle === "yearly" ? ` · ${money(prices.yearly)} por ano` : ""}</span>`;
    proCard.querySelectorAll("[data-cycle]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.cycle === cycle)));
  }
  if (proCard && !proCard.querySelector(".kz-price")) {
    const tagline = proCard.querySelector(".plan-card-pro-tagline");
    const box = document.createElement("div");
    box.innerHTML = `<div class="kz-cycle" role="group" aria-label="Ciclo de cobrança"><button type="button" data-cycle="monthly">Mensal</button><button type="button" data-cycle="yearly">Anual<em>2 meses grátis</em></button></div><div class="kz-price"></div>`;
    (tagline || proCard.firstElementChild)?.after(...box.childNodes);
    proCard.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cycle]");
      if (!button) return;
      cycle = button.dataset.cycle;
      renderPrice();
    });
    renderPrice();
    fetch("/api/billing/checkout", { headers: { Accept: "application/json" } }).then((response) => response.ok ? response.json() : null).then((data) => {
      (data?.cycles || []).forEach((item) => { if (item.amountCents) prices[item.cycle] = item.amountCents; });
      renderPrice();
    }).catch(() => {});
  }

  proButton?.addEventListener("click", async () => {
    if (app?.classList.contains("kz-is-pro")) { toast("Seu KAZER Pro já está ativo."); return; }
    const label = proButton.innerHTML;
    proButton.disabled = true;
    proButton.textContent = "Abrindo pagamento…";
    try {
      const data = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ cycle }) });
      if (data?.url && /^https:\/\//.test(data.url)) window.location.assign(data.url);
      else throw new Error("Não foi possível abrir o pagamento.");
    } catch (error) {
      toast(/em breve/i.test(error.message) ? "O pagamento do Pro abre em breve. Avisaremos você por aqui." : error.message);
      proButton.disabled = false;
      proButton.innerHTML = label;
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("pro") === "success") window.setTimeout(() => toast("Pagamento recebido! Seu KAZER Pro é ativado assim que o PIX for confirmado."), 1200);
  if (params.get("pro") === "canceled") window.setTimeout(() => toast("Pagamento não concluído. Você pode tentar de novo quando quiser."), 1200);

  /* ── Inicialização ─────────────────────────────────────────────────── */
  renderChips();
  renderConnectors();
  window.setTimeout(loadVercel, 900);
})();
