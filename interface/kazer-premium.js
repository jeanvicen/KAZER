/*
 * KAZER — Obsidian & Gold: sugestões dinâmicas da tela inicial.
 * Copyright © 2026 Jean V. / @jeanvicen · KLYPZA. Código proprietário.
 * As sugestões só preenchem o campo existente; nunca enviam mensagens.
 */
(() => {
  "use strict";

  // Atualize aqui para ajustar a cadência; chamadas só ocorrem no estado vazio elegível.
  const SUGGESTION_INTERVAL_MS = 120000;
  const CACHE_KEY = "kazer.homeSuggestions.v1";
  const CACHE_LIMIT = 20;
  const CATEGORY_ICONS = {
    plan: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    write: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    learn: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    creativity: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    curiosity: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    health: '<path d="M20.5 8.8c0 5.1-8.5 10-8.5 10s-8.5-4.9-8.5-10A4.5 4.5 0 0 1 12 6.2a4.5 4.5 0 0 1 8.5 2.6Z"/><path d="M8 12h2l1.2-2.2 1.7 4.4L14.2 12H16"/>',
    finance: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    productivity: '<path d="M12 3v9l6 3"/><circle cx="12" cy="12" r="9"/>',
    wellbeing: '<path d="M12 20s-7.5-4.4-7.5-10a4 4 0 0 1 7.5-1.8A4 4 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z"/>'
  };
  const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_ICONS));
  const FALLBACK_BANK = [
    { texto: "Organizar ideias em etapas", categoria: "plan" },
    { texto: "Montar um plano de hoje", categoria: "plan" },
    { texto: "Priorizar minhas tarefas", categoria: "plan" },
    { texto: "Planejar uma semana leve", categoria: "plan" },
    { texto: "Criar uma rotina possível", categoria: "plan" },
    { texto: "Escrever com mais clareza", categoria: "write" },
    { texto: "Rascunhar uma mensagem gentil", categoria: "write" },
    { texto: "Dar forma a uma ideia", categoria: "write" },
    { texto: "Resumir um texto longo", categoria: "write" },
    { texto: "Revisar meu próximo parágrafo", categoria: "write" },
    { texto: "Entender um tema novo", categoria: "learn" },
    { texto: "Explicar algo com exemplos", categoria: "learn" },
    { texto: "Aprender um conceito por analogia", categoria: "learn" },
    { texto: "Criar um roteiro de estudo", categoria: "learn" },
    { texto: "Explorar uma pergunta curiosa", categoria: "curiosity" },
    { texto: "Descobrir conexões inesperadas", categoria: "curiosity" },
    { texto: "Investigar uma ideia diferente", categoria: "curiosity" },
    { texto: "Imaginar um futuro possível", categoria: "creativity" },
    { texto: "Inventar nomes para um projeto", categoria: "creativity" },
    { texto: "Criar uma história breve", categoria: "creativity" },
    { texto: "Encontrar outro ângulo criativo", categoria: "creativity" },
    { texto: "Transformar ideia em protótipo", categoria: "code" },
    { texto: "Revisar um trecho de código", categoria: "code" },
    { texto: "Desenhar uma função simples", categoria: "code" },
    { texto: "Depurar um erro com calma", categoria: "code" },
    { texto: "Entender melhor meu orçamento", categoria: "finance" },
    { texto: "Comparar duas opções com calma", categoria: "finance" },
    { texto: "Criar uma meta financeira realista", categoria: "finance" },
    { texto: "Planejar uma pausa revigorante", categoria: "health" },
    { texto: "Montar um treino equilibrado", categoria: "health" },
    { texto: "Pensar em hábitos mais saudáveis", categoria: "health" },
    { texto: "Encontrar foco sem pressa", categoria: "productivity" },
    { texto: "Dividir uma tarefa difícil", categoria: "productivity" },
    { texto: "Preparar uma conversa importante", categoria: "wellbeing" },
    { texto: "Desacelerar com uma pausa curta", categoria: "wellbeing" },
    { texto: "Encontrar uma pequena conquista", categoria: "wellbeing" }
  ];

  const dock = document.querySelector(".composer-dock");
  const app = document.getElementById("app");
  const emptyState = document.getElementById("emptyState");
  const input = document.getElementById("messageInput");
  if (!dock || !app || !emptyState || !input || dock.querySelector(".kz-suggestions")) return;

  const wrap = document.createElement("div");
  wrap.className = "kz-suggestions";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Sugestões para começar");
  dock.appendChild(wrap);
  dock.style.flexDirection = "column";
  dock.style.alignItems = "center";

  const safeStorage = {
    read() {
      try {
        const value = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        return value && Array.isArray(value.items) ? value : null;
      } catch (_) { return null; }
    },
    write(value) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch (_) {} }
  };
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  const validItem = (item) => {
    if (!item || typeof item !== "object" || typeof item.texto !== "string" || typeof item.categoria !== "string") return null;
    const texto = item.texto.normalize("NFC").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
    const categoria = item.categoria.trim().toLowerCase();
    const words = texto.split(/\s+/).filter(Boolean);
    if (texto.length < 5 || texto.length > 64 || words.length < 2 || words.length > 5 || !ALLOWED_CATEGORIES.has(categoria)) return null;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ,:!?'-]*$/u.test(texto)) return null;
    if (["como posso ajudar", "faca uma pergunta", "o que voce quer", "me surpreenda"].includes(normalize(texto))) return null;
    return { texto, categoria };
  };
  let recentItems = (safeStorage.read()?.items || []).map(validItem).filter(Boolean).slice(-CACHE_LIMIT);
  let fallbackCursor = Number(safeStorage.read()?.fallbackCursor || 0) % FALLBACK_BANK.length;
  let timer = null;
  let transitionTimer = null;
  let dueAt = 0;
  let remainingMs = SUGGESTION_INTERVAL_MS;
  let activeRequest = null;
  let typingUntil = 0;
  let hasBooted = false;

  const createIcon = (category) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.65");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const markup = CATEGORY_ICONS[category] || CATEGORY_ICONS.creativity;
    const template = document.createElement("template");
    template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
    Array.from(template.content.firstElementChild.children).forEach((shape) => svg.appendChild(shape.cloneNode(true)));
    return svg;
  };
  const fillInput = (item) => {
    // Preserve the existing behavior exactly: fill, dispatch input, focus, place caret; never submit.
    input.value = item.prompt || item.texto;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  };
  const render = (items, { skeleton = false, animate = false } = {}) => {
    const build = () => {
      wrap.replaceChildren();
      for (let index = 0; index < 4; index += 1) {
        const item = items[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = `kz-suggestion${skeleton ? " is-skeleton" : animate ? " is-entering" : ""}`;
        button.disabled = skeleton || !item;
        if (skeleton) {
          button.setAttribute("aria-hidden", "true");
          const shimmer = document.createElement("span");
          shimmer.className = "kz-suggestion-shimmer";
          button.appendChild(shimmer);
        } else if (item) {
          button.dataset.category = item.categoria;
          button.appendChild(createIcon(item.categoria));
          const label = document.createElement("span");
          label.className = "kz-suggestion-label";
          label.textContent = item.texto;
          button.appendChild(label);
          button.addEventListener("click", () => fillInput(item));
        }
        wrap.appendChild(button);
      }
      if (animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        window.setTimeout(() => wrap.querySelectorAll(".is-entering").forEach((card) => card.classList.remove("is-entering")), 700);
      }
    };
    if (animate && wrap.children.length && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      wrap.classList.add("is-exiting");
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = window.setTimeout(() => { transitionTimer = null; build(); wrap.classList.remove("is-exiting"); }, 150);
    } else {
      build();
      wrap.classList.remove("is-exiting");
    }
  };
  const remember = (items) => {
    recentItems = [...recentItems, ...items.map(({ texto, categoria }) => ({ texto, categoria }))].slice(-CACHE_LIMIT);
    safeStorage.write({ items: recentItems, fallbackCursor });
  };
  const fallbackBatch = () => {
    const recentTexts = new Set(recentItems.map((item) => normalize(item.texto)));
    const output = [];
    for (let index = 0; index < FALLBACK_BANK.length && output.length < 4; index += 1) {
      const candidate = FALLBACK_BANK[(fallbackCursor + index) % FALLBACK_BANK.length];
      if (!recentTexts.has(normalize(candidate.texto))) output.push(candidate);
    }
    fallbackCursor = (fallbackCursor + Math.max(4, output.length)) % FALLBACK_BANK.length;
    return output;
  };
  const timeBand = () => {
    const hour = new Date().getHours();
    return hour < 5 ? "madrugada" : hour < 12 ? "manha" : hour < 18 ? "tarde" : hour < 22 ? "noite" : "madrugada";
  };
  const eligible = () => !document.hidden && !emptyState.hidden && !app.classList.contains("in-conversation") && !app.classList.contains("history-active") && !input.value.trim() && !(document.activeElement === input && Date.now() < typingUntil);
  const stopTimer = (preserve = true) => {
    if (timer !== null) {
      if (preserve) remainingMs = Math.max(0, dueAt - Date.now());
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const abortRequest = () => {
    if (activeRequest && !activeRequest.signal.aborted) activeRequest.abort();
  };
  const schedule = (delay = remainingMs) => {
    if (timer !== null || !eligible()) return;
    if (activeRequest) delay = Math.max(delay, 800);
    remainingMs = Math.max(0, delay);
    dueAt = Date.now() + remainingMs;
    timer = window.setTimeout(() => {
      timer = null;
      remainingMs = SUGGESTION_INTERVAL_MS;
      refreshSuggestions();
    }, remainingMs);
  };
  const refreshSuggestions = async () => {
    if (!eligible() || activeRequest) { schedule(activeRequest ? 1000 : remainingMs); return; }
    const controller = new AbortController();
    activeRequest = controller;
    const recentlyShown = recentItems.slice(-CACHE_LIMIT).map((item) => item.texto);
    try {
      const response = await window.kazerFetchHomeSuggestions({ localTimeBand: timeBand(), recentSuggestions: recentlyShown }, controller.signal);
      if (!response.ok) throw new Error("Suggestions unavailable");
      const payload = await response.json();
      if (controller.signal.aborted || !eligible()) return;
      const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions.map(validItem).filter(Boolean) : [];
      const recentSet = new Set(recentItems.map((item) => normalize(item.texto)));
      const unique = [];
      for (const item of suggestions) {
        const key = normalize(item.texto);
        if (!recentSet.has(key) && !unique.some((seen) => normalize(seen.texto) === key)) unique.push(item);
      }
      const batch = unique.length === 4 ? unique : fallbackBatch();
      remember(batch);
      render(batch, { animate: true });
    } catch (_) {
      if (!controller.signal.aborted && eligible()) {
        const batch = fallbackBatch();
        remember(batch);
        render(batch, { animate: true });
      }
    } finally {
      if (activeRequest === controller) activeRequest = null;
      if (eligible()) schedule(SUGGESTION_INTERVAL_MS);
    }
  };
  const reconcile = () => {
    if (!eligible()) {
      stopTimer(true);
      if (transitionTimer !== null) { window.clearTimeout(transitionTimer); transitionTimer = null; wrap.classList.remove("is-exiting"); }
      // Hidden tabs and active composition cancel network work; resume only when eligible again.
      abortRequest();
      if (!input.value.trim() && document.activeElement !== input && !document.hidden && (emptyState.hidden || app.classList.contains("in-conversation"))) remainingMs = SUGGESTION_INTERVAL_MS;
      return;
    }
    if (!hasBooted) {
      hasBooted = true;
      const cachedBatch = recentItems.slice(-4);
      if (cachedBatch.length === 4) render(cachedBatch);
      else render([], { skeleton: true });
      refreshSuggestions();
      return;
    }
    schedule(remainingMs);
  };

  // Render from session cache immediately when available; otherwise show four lightweight placeholders.
  if (recentItems.length >= 4) render(recentItems.slice(-4));
  else render([], { skeleton: true });
  if (typeof window.kazerFetchHomeSuggestions !== "function") {
    render(fallbackBatch(), { animate: false });
  } else {
    const observer = new MutationObserver(reconcile);
    observer.observe(app, { attributes: true, attributeFilter: ["class"] });
    observer.observe(emptyState, { attributes: true, attributeFilter: ["hidden", "class"] });
    input.addEventListener("input", () => {
      typingUntil = Date.now() + 1500;
      reconcile();
      window.setTimeout(reconcile, 1600);
    });
    input.addEventListener("focus", reconcile);
    input.addEventListener("blur", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    document.addEventListener("kazer:navigation-change", reconcile);
    reconcile();
  }
})();
