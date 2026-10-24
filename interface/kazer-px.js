/*
 * KAZER PX — camada final de layout inspirada em motores de resposta e
 * agentes (barra lateral com rótulos, topo móvel, seletor de modelo dentro
 * do campo, painel "Computador do KAZER"). Não remove nenhuma ferramenta:
 * só reorganiza os elementos criados por chat.html, kazer-nova e kazer-studio.
 */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $("#app");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LABELS = { new: "Novo chat", home: "Início", history: "Histórico", connectors: "Conectores", computer: "Computer", settings: "Configurações" };

  /* ── Barra lateral com rótulos ─────────────────────────────────────── */
  function upgradeRail() {
    const rail = $(".kz-rail");
    if (!rail || rail.dataset.px) return Boolean(rail);
    rail.dataset.px = "1";
    rail.querySelectorAll(".kz-rail-btn").forEach((button) => {
      const label = LABELS[button.dataset.rail] || button.dataset.tip || "";
      if (label && !button.querySelector(".kz-px-label")) button.insertAdjacentHTML("beforeend", `<span class="kz-px-label">${escapeHtml(label)}</span>`);
    });
    const logo = $(".kz-rail-logo", rail);
    if (logo && !logo.querySelector(".kz-px-word")) logo.insertAdjacentHTML("beforeend", '<span class="kz-px-word">kazer</span>');
    const pro = $(".kz-rail-pro", rail);
    if (pro && !pro.querySelector(".kz-px-label")) pro.innerHTML = '<span class="kz-px-pro-mark">PRO</span><span class="kz-px-label"><b>KAZER Pro</b><small>10× mais uso e pesquisa a fundo</small></span>';
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "kz-px-collapse";
    toggle.setAttribute("aria-label", "Recolher barra lateral");
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
    toggle.addEventListener("click", () => {
      const collapsed = app.classList.toggle("kz-px-rail-collapsed");
      try { localStorage.setItem("kazer-rail-collapsed", collapsed ? "1" : "0"); } catch {}
    });
    rail.prepend(toggle);
    try { if (localStorage.getItem("kazer-rail-collapsed") === "1") app.classList.add("kz-px-rail-collapsed"); } catch {}
    return true;
  }

  /* ── Topo no celular: menu · marca · novo chat ─────────────────────── */
  function upgradeTopbar() {
    const topbar = $(".topbar");
    if (!topbar || topbar.dataset.px) return;
    topbar.dataset.px = "1";
    const back = $("#chatHistoryBack");
    if (back) back.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h11M4 17h16"/></svg>';
    const brand = document.createElement("a");
    brand.className = "kz-px-topbrand";
    brand.href = "?view=chat";
    brand.setAttribute("aria-label", "KAZER, novo chat");
    brand.innerHTML = '<img src="../download/assets/kazer-alien.svg?v=20261023" alt="" width="22" height="22"><span>kazer</span>';
    const fresh = document.createElement("a");
    fresh.className = "kz-px-topnew";
    fresh.href = "?view=chat";
    fresh.setAttribute("aria-label", "Novo chat");
    fresh.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    topbar.append(brand, fresh);
  }

  /* ── Seletor de modelo no topo, ao centro (como ChatGPT e Grok) ────── */
  function moveModelPicker() {
    const picker = $(".kz-model");
    const topbar = $(".topbar");
    if (!picker || !topbar) return Boolean(picker);
    if (picker.parentElement !== topbar) topbar.append(picker);
    picker.classList.add("kz-model--top");
    return true;
  }

  /* ── Painel "Computador do KAZER" (estilo Manus) ───────────────────── */
  const panel = document.createElement("aside");
  panel.className = "kz-px-computer";
  panel.setAttribute("aria-label", "Computador do KAZER");
  panel.hidden = true;
  panel.innerHTML = '<header><span class="kz-px-dot"></span><strong>Computador do KAZER</strong><small data-status>Pronto</small><button type="button" data-close aria-label="Fechar painel">✕</button></header><div class="kz-px-screen"><div class="kz-px-screen-bar"><i></i><i></i><i></i><span data-target>aguardando tarefa</span></div><ol class="kz-px-steps" data-steps></ol></div><section><h4>Ações executadas</h4><ol class="kz-px-log" data-log><li class="is-empty">Nenhuma ação ainda. No modo Computer, cada branch, commit, PR ou deploy aparece aqui.</li></ol></section>';
  document.body.append(panel);
  $("[data-close]", panel).addEventListener("click", () => { panel.hidden = true; app?.classList.remove("kz-px-computer-open"); });
  const openPanel = () => { if (window.matchMedia("(min-width: 1180px)").matches) { panel.hidden = false; app?.classList.add("kz-px-computer-open"); } };

  const decorate = window.kazerDecorateThinking;
  window.kazerDecorateThinking = (row, options = {}) => {
    decorate?.(row, options);
    if (options.mode !== "computer") return;
    openPanel();
    panel.classList.add("is-running");
    $("[data-status]", panel).textContent = "trabalhando…";
    $("[data-target]", panel).textContent = options.repo?.fullName || "ambiente KAZER";
    const steps = ["Entendendo a tarefa", options.repo?.fullName ? `Abrindo ${options.repo.fullName}` : "Preparando o ambiente", "Planejando as alterações", "Executando ferramentas", "Revisando o resultado"];
    const list = $("[data-steps]", panel);
    list.innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    const items = [...list.children];
    let index = 0;
    const tick = () => {
      if (!panel.classList.contains("is-running")) return;
      items.forEach((item, position) => { item.classList.toggle("is-done", position < index); item.classList.toggle("is-on", position === index); });
      if (index < items.length - 1) { index += 1; window.setTimeout(tick, 2400 + index * 800); }
    };
    tick();
    // A linha "pensando" é removida quando a resposta chega: aí o painel conclui.
    let seen = false;
    const watcher = window.setInterval(() => {
      if (row.isConnected) { seen = true; return; }
      if (!seen) return;
      window.clearInterval(watcher);
      panel.classList.remove("is-running");
      $("[data-status]", panel).textContent = "concluído";
      items.forEach((item) => { item.classList.remove("is-on"); item.classList.add("is-done"); });
    }, 400);
  };

  const renderActions = window.kazerRenderActions;
  window.kazerRenderActions = (row, actions, mode) => {
    renderActions?.(row, actions, mode);
    const log = $("[data-log]", panel);
    log.querySelector(".is-empty")?.remove();
    actions.forEach((action, index) => log.insertAdjacentHTML("afterbegin", `<li class="${action.state === "error" ? "is-error" : ""}" style="--kz-li:${index}"><i>${action.state === "error" ? "!" : "✓"}</i><span><b>${escapeHtml(action.label)}</b>${action.target ? `<code>${escapeHtml(action.target)}</code>` : ""}</span></li>`));
    if (mode === "computer") openPanel();
  };

  /* ── Placeholder de acompanhamento (como "Ask follow-up") ──────────── */
  const input = $("#messageInput");
  const syncPlaceholder = () => {
    if (!input) return;
    const computer = window.kazerChatMode === "computer";
    const inConversation = app?.classList.contains("in-conversation");
    input.placeholder = computer ? (inConversation ? "Peça a próxima tarefa ao Computer…" : "Descreva uma tarefa — o KAZER executa no GitHub e na Vercel…") : (inConversation ? "Pergunte algo de acompanhamento…" : "Pergunte qualquer coisa…");
  };
  if (app) new MutationObserver(syncPlaceholder).observe(app, { attributes: true, attributeFilter: ["class"] });

  /* ── Inicialização (os módulos anteriores carregam com defer) ──────── */
  let attempts = 0;
  const boot = () => {
    upgradeTopbar();
    const ready = upgradeRail() & moveModelPicker();
    syncPlaceholder();
    if (!ready && attempts++ < 20) window.setTimeout(boot, 150);
  };
  boot();
})();
