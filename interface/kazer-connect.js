/*
 * KAZER Connect — conectar serviços em poucos toques.
 * • "Solicitar conector": a pessoa descreve o que quer; o pedido vai para o
 *   chat e o KAZER responde com um cartão "Conectar" do serviço oficial.
 * • Cartão Conectar (```kazer-connect): login oficial (OAuth) e volta ao KAZER
 *   já conectado, ou o cartão seguro para colar a chave.
 * • Cartão seguro: a credencial vai direto ao servidor (cifrada), nunca para o
 *   chat, o histórico ou o modelo, e nunca é exibida de volta.
 * • Guarda de segredos: se a pessoa colar uma chave ou senha no chat, o envio
 *   para e o KAZER oferece o cartão seguro.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (message) => (window.kazerShowToast ? window.kazerShowToast(message) : console.info(message));
  const api = (path, options) => (window.kazerWorkspace?.api ? window.kazerWorkspace.api(path, options) : Promise.reject(new Error("Entre na sua conta para conectar serviços.")));
  const LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';
  const PLUG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5"/></svg>';

  const state = { catalog: [], loaded: false, loading: null };

  async function loadCatalog(force = false) {
    if (state.loading && !force) return state.loading;
    state.loading = api("/api/connect").then((data) => {
      state.catalog = Array.isArray(data.connectors) ? data.connectors : [];
      state.loaded = true;
      // Com serviços conectados, a mensagem vai pelo caminho com ferramentas.
      window.kazerHubConnected = state.catalog.some((item) => item.connected && !item.builtin);
      document.querySelectorAll(".kz-cx-card[data-cx]").forEach(refreshCard);
      renderHub();
      return state.catalog;
    }).catch(() => { state.loaded = false; return []; }).finally(() => { state.loading = null; });
    return state.loading;
  }
  const findItem = (id) => state.catalog.find((item) => item.id === id) || null;
  const initials = (name) => String(name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };
  const baseDomain = (host) => host.split(".").slice(-2).join(".");

  /* ── Cartão Conectar / cartão seguro ─────────────────────────────────── */
  function parseSpec(code) {
    try {
      const spec = JSON.parse(String(code || "").trim());
      if (!spec || typeof spec !== "object") return null;
      if (spec.custom) {
        const host = hostOf(spec.baseUrl);
        if (!host || !/^https:/i.test(spec.baseUrl)) return null;
        const tokenHost = hostOf(spec.tokenPage);
        return { custom: true, id: `custom:${host}`, name: String(spec.name || host).slice(0, 60), baseUrl: spec.baseUrl, host, auth: String(spec.auth || "bearer"), tokenPage: tokenHost && baseDomain(tokenHost) === baseDomain(host) && /^https:/i.test(spec.tokenPage) ? spec.tokenPage : "" };
      }
      return spec.id ? { id: String(spec.id).slice(0, 120) } : null;
    } catch { return null; }
  }

  function secureForm(item, spec) {
    const fields = spec?.custom ? [{ name: "token", label: "Chave / token de acesso", secret: true }] : item.fields || [];
    const tokenPage = spec?.custom ? spec.tokenPage : item.tokenPage;
    return `<form class="kz-cx-secure" autocomplete="off" novalidate>
      <div class="kz-cx-secure-head">${LOCK}<strong>Cartão seguro</strong><span>AES-256-GCM</span></div>
      ${item.site ? `<label>${escapeHtml(item.site.label)}<input name="site" inputmode="url" autocomplete="off" spellcheck="false" placeholder="empresa${escapeHtml(item.site.suffix)}" required></label>` : ""}
      ${fields.map((field) => `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.name)}" type="${field.secret ? "password" : "text"}" autocomplete="${field.secret ? "new-password" : "off"}" spellcheck="false" required></label>`).join("")}
      ${spec?.custom ? `<p class="kz-cx-host">A chave será enviada <b>somente</b> para <code>${escapeHtml(spec.host)}</code>.</p>` : ""}
      ${tokenPage ? `<a class="kz-cx-official" href="${escapeHtml(tokenPage)}" target="_blank" rel="noopener noreferrer">Criar a chave no site oficial ↗</a>` : ""}
      <button class="kz-cx-btn is-primary" type="submit">${LOCK}<span>Conectar com segurança</span></button>
      <small>Vai direto para o servidor do KAZER, cifrado. Nunca aparece no chat, no histórico nem para a IA.</small>
    </form>`;
  }

  function cardHtml(spec) {
    const item = spec.custom ? { id: spec.id, name: spec.name, description: spec.host, token: true, connected: findItem(spec.id)?.connected, account: findItem(spec.id)?.account } : findItem(spec.id);
    if (!item) {
      return `<div class="kz-cx-top"><span class="kz-cx-icon">${PLUG}</span><div><strong>${escapeHtml(spec.id)}</strong><small>${state.loaded ? "Ainda não está no catálogo. Peça ao KAZER para procurar a API oficial." : "Carregando conectores…"}</small></div></div>`;
    }
    const top = `<div class="kz-cx-top"><span class="kz-cx-icon">${escapeHtml(initials(item.name))}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.connected ? `Conectado${item.account ? ` · ${item.account}` : ""}` : item.description || "")}</small></div>${item.connected ? '<span class="kz-cx-ok">✓</span>' : ""}</div>`;
    if (item.connected) return `${top}<div class="kz-cx-actions"><button class="kz-cx-btn" type="button" data-cx-off>Desconectar</button></div>`;
    const steps = '<ol class="kz-cx-steps"><li>Toque em conectar</li><li>Autorize no site oficial</li><li>Pronto, volta aqui conectado</li></ol>';
    if (item.builtin) return `${top}${steps}<div class="kz-cx-actions"><button class="kz-cx-btn is-primary" type="button" data-cx-builtin="${escapeHtml(item.builtin)}">Conectar ${escapeHtml(item.name)}</button></div>`;
    const oauth = item.oauth ? `<button class="kz-cx-btn is-primary" type="button" data-cx-oauth>Entrar com ${escapeHtml(item.name.replace(/\s*\(.*\)/, ""))}</button>` : "";
    const token = item.token ? `<button class="kz-cx-btn${item.oauth ? "" : " is-primary"}" type="button" data-cx-secure>${LOCK}<span>${item.oauth ? "Usar chave" : "Abrir cartão seguro"}</span></button>` : "";
    const none = !oauth && !token ? '<p class="kz-cx-note">O login oficial deste serviço ainda não foi ativado neste KAZER.</p>' : "";
    return `${top}${item.oauth ? steps : ""}<div class="kz-cx-actions">${oauth}${token}</div>${none}<div class="kz-cx-slot"></div>`;
  }

  function refreshCard(card) {
    const spec = JSON.parse(card.dataset.cx || "null");
    if (!spec) return;
    const open = Boolean($(".kz-cx-secure", card));
    card.innerHTML = cardHtml(spec);
    if (open && !findItem(spec.id)?.connected) openSecure(card, spec);
  }

  function openSecure(card, spec) {
    const slot = $(".kz-cx-slot", card);
    const item = spec.custom ? { fields: null } : findItem(spec.id);
    if (!slot || !item) return;
    slot.innerHTML = secureForm(item, spec);
    $("input", slot)?.focus({ preventScroll: true });
  }

  async function submitSecure(form, card, spec) {
    const button = $("[type=submit]", form);
    const values = {};
    [...form.elements].forEach((input) => { if (input.name) values[input.name] = input.value; });
    if (Object.values(values).some((value) => !String(value).trim())) { toast("Preencha todos os campos do cartão seguro."); return; }
    button.disabled = true;
    $("span", button).textContent = "Verificando no serviço oficial…";
    try {
      const body = spec.custom ? { action: "custom", name: spec.name, baseUrl: spec.baseUrl, auth: spec.auth, fields: values } : { id: spec.id, fields: values };
      const data = await api("/api/connect", { method: "POST", body: JSON.stringify(body) });
      toast(`${spec.name || findItem(spec.id)?.name || "Serviço"} conectado${data.account ? ` como ${data.account}` : ""}.`);
      await loadCatalog(true);
      window.dispatchEvent(new CustomEvent("kazer:connectors-changed"));
    } catch (error) {
      toast(error.message || "Não foi possível conectar.");
      button.disabled = false;
      $("span", button).textContent = "Conectar com segurança";
    } finally {
      // Os valores digitados nunca ficam na página.
      [...form.elements].forEach((input) => { if (input.type === "password") input.value = ""; });
    }
  }

  async function startOAuth(spec, button) {
    button.disabled = true;
    button.textContent = "Abrindo site oficial…";
    try {
      const data = await api("/api/connect", { method: "POST", body: JSON.stringify({ action: "start", id: spec.id }) });
      if (!/^https:\/\//.test(data.url || "")) throw new Error("URL de autorização inválida.");
      try { sessionStorage.setItem("kazer-connect-return", window.location.pathname + window.location.search); } catch {}
      window.location.assign(data.url);
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = "Tentar de novo";
    }
  }

  function renderConnectCard(code) {
    const spec = parseSpec(code);
    if (!spec) return null;
    const card = document.createElement("section");
    card.className = "kz-cx-card";
    card.dataset.cx = JSON.stringify(spec);
    card.innerHTML = cardHtml(spec);
    if (!state.loaded) loadCatalog();
    return card;
  }
  window.kazerRenderConnectCard = renderConnectCard;

  document.addEventListener("click", async (event) => {
    const card = event.target.closest(".kz-cx-card[data-cx]");
    if (!card) return;
    const spec = JSON.parse(card.dataset.cx || "null");
    if (!spec) return;
    const builtin = event.target.closest("[data-cx-builtin]")?.dataset.cxBuiltin;
    if (builtin === "github") return window.kazerWorkspace?.connectGitHub?.();
    if (builtin) { window.kazerOpenConnectors?.(); return; }
    const oauth = event.target.closest("[data-cx-oauth]");
    if (oauth) return startOAuth(spec, oauth);
    if (event.target.closest("[data-cx-secure]")) return openSecure(card, spec);
    if (event.target.closest("[data-cx-off]")) {
      try { await api("/api/connect", { method: "DELETE", body: JSON.stringify({ id: spec.id }) }); toast("Desconectado."); } catch (error) { toast(error.message); }
      await loadCatalog(true);
      window.dispatchEvent(new CustomEvent("kazer:connectors-changed"));
    }
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest(".kz-cx-secure");
    if (!form) return;
    event.preventDefault();
    const card = form.closest(".kz-cx-card");
    submitSecure(form, card, JSON.parse(card.dataset.cx || "null") || {});
  });

  /* ── Modal genérico ──────────────────────────────────────────────────── */
  function modal(inner, className = "") {
    $(".kz-cx-modal")?.remove();
    const root = document.createElement("div");
    root.className = `kz-cx-modal ${className}`;
    root.innerHTML = `<div class="kz-cx-backdrop" data-cx-close></div><div class="kz-cx-sheet" role="dialog" aria-modal="true"><button class="kz-cx-x" type="button" data-cx-close aria-label="Fechar">×</button>${inner}</div>`;
    root.addEventListener("click", (event) => { if (event.target.closest("[data-cx-close]")) root.remove(); });
    document.addEventListener("keydown", function onKey(event) { if (event.key === "Escape") { root.remove(); document.removeEventListener("keydown", onKey); } });
    document.body.append(root);
    return root;
  }

  function openConnectModal(id) {
    const root = modal("");
    const card = renderConnectCard(JSON.stringify(id.startsWith("custom:") ? { id } : { id }));
    if (card) $(".kz-cx-sheet", root).append(card);
  }

  /* ── Solicitar conector com o KAZER ──────────────────────────────────── */
  function sendToChat(text) {
    const input = $("#messageInput");
    const send = $("#sendButton");
    if (!input || !send) return;
    $("#connectorsBack")?.click();
    document.querySelector(".kz-sheet [data-close], .kz-sheet-close")?.click();
    window.setTimeout(() => {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      send.disabled = false;
      send.click();
    }, 260);
  }

  function openRequest() {
    const root = modal(`<form class="kz-cx-request">
      <span class="kz-cx-icon is-big">${PLUG}</span>
      <h2>Solicitar conector</h2>
      <p>Diga o que você quer conectar. O KAZER procura o caminho oficial e te manda o cartão para conectar em poucos toques.</p>
      <textarea name="what" rows="3" maxlength="300" placeholder="Ex.: minha conta do Notion, o Trello da empresa, a API do meu e-commerce…" required></textarea>
      <div class="kz-cx-chips">${["Notion", "Google Agenda", "Slack", "Linear", "Stripe", "Supabase"].map((name) => `<button type="button" data-fill="${name}">${name}</button>`).join("")}</div>
      <button class="kz-cx-btn is-primary" type="submit">Pedir ao KAZER</button>
      <small>${LOCK} Senhas e chaves nunca vão pelo chat: o KAZER te entrega um cartão seguro.</small>
    </form>`, "is-request");
    const form = $("form", root);
    form.what.focus();
    root.addEventListener("click", (event) => { const fill = event.target.closest("[data-fill]"); if (fill) { form.what.value = fill.dataset.fill; form.what.focus(); } });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const what = form.what.value.trim();
      if (!what) return;
      root.remove();
      sendToChat(`Quero conectar o KAZER a: ${what}`);
    });
  }
  window.kazerRequestConnector = openRequest;

  /* ── Hub na tela de Conectores ───────────────────────────────────────── */
  let filter = "";
  function renderHub() {
    const body = $("#connectorsBody");
    if (!body) return;
    let hub = $(".kz-cx-hub", body);
    if (!hub) {
      hub = document.createElement("section");
      hub.className = "kz-cx-hub";
      body.prepend(hub);
    }
    const items = state.catalog.filter((item) => !item.builtin && (!filter || `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(filter)));
    const connected = items.filter((item) => item.connected).length;
    const prevFocus = document.activeElement?.matches?.(".kz-cx-search") ? document.activeElement.selectionStart : null;
    hub.innerHTML = `<button class="kz-cx-ask" type="button" data-cx-ask><span class="kz-cx-icon">${PLUG}</span><span><strong>Solicitar conector com o KAZER</strong><small>Diga o que quer conectar e o KAZER acha o caminho oficial.</small></span><i>›</i></button>
      <div class="kz-cx-hub-head"><h3>Prontos para conectar</h3><small>${state.loaded ? `${state.catalog.filter((item) => !item.builtin).length} serviços${connected ? ` · ${connected} conectado${connected === 1 ? "" : "s"}` : ""}` : "carregando…"}</small></div>
      <input class="kz-cx-search" type="search" placeholder="Buscar serviço (Notion, Slack, Stripe…)" value="${escapeHtml(filter)}" aria-label="Buscar serviço">
      <div class="kz-cx-grid">${items.map((item, index) => `<button type="button" class="kz-cx-tile${item.connected ? " is-on" : ""}" data-cx-open="${escapeHtml(item.id)}" style="--kz-li:${Math.min(index, 24)}"><span class="kz-cx-icon">${escapeHtml(initials(item.name))}</span><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.connected ? `Conectado${item.account ? ` · ${item.account}` : ""}` : item.category)}</small></span>${item.connected ? "<i>✓</i>" : ""}</button>`).join("") || '<p class="kz-cx-empty">Nada aqui. Use "Solicitar conector" que o KAZER procura.</p>'}</div>`;
    if (prevFocus !== null) { const search = $(".kz-cx-search", hub); search.focus(); search.setSelectionRange(prevFocus, prevFocus); }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cx-ask]")) { openRequest(); return; }
    const open = event.target.closest("[data-cx-open]");
    if (open) openConnectModal(open.dataset.cxOpen);
  });
  document.addEventListener("input", (event) => {
    if (!event.target.matches?.(".kz-cx-search")) return;
    filter = event.target.value.trim().toLowerCase();
    renderHub();
  });

  const connectorsBody = $("#connectorsBody");
  if (connectorsBody) {
    // A tela de Conectores é redesenhada por outros módulos: reinsere o hub.
    new MutationObserver(() => { if (!$(".kz-cx-hub", connectorsBody)) renderHub(); }).observe(connectorsBody, { childList: true });
    const screen = $("#connectorsScreen");
    if (screen) new MutationObserver(() => { if (!screen.hidden) loadCatalog(true); }).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  }

  /* ── Volta do login oficial ──────────────────────────────────────────── */
  const params = new URLSearchParams(window.location.search);
  const status = params.get("connector");
  if (status) {
    const id = params.get("id") || "";
    params.delete("connector");
    params.delete("id");
    const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", clean);
    window.setTimeout(async () => {
      await loadCatalog(true);
      const name = findItem(id)?.name || "Serviço";
      toast(status === "connected" ? `${name} conectado ao KAZER. ✓` : `Não deu para conectar ${name}. Tente de novo.`);
      window.dispatchEvent(new CustomEvent("kazer:connectors-changed"));
    }, 900);
  }

  window.setTimeout(() => { if (window.kazerWorkspace?.api) loadCatalog(); }, 1800);

  /* ── Guarda de segredos no campo de mensagem ─────────────────────────── */
  const SECRET_PATTERNS = [
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bglpat-[A-Za-z0-9_-]{20,}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{30,}/, /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
    /\b(?:ntn|secret)_[A-Za-z0-9]{30,}/, /\blin_api_[A-Za-z0-9]{30,}/, /\bhf_[A-Za-z0-9]{30,}/, /\br8_[A-Za-z0-9]{30,}/, /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
    /\bvercel_[A-Za-z0-9]{20,}|\b[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:senha|password|passwd|pwd|token|api[_ -]?key|chave(?: de api)?)\s*[:=]\s*\S{6,}/i,
  ];
  const findSecret = (text) => SECRET_PATTERNS.map((pattern) => text.match(pattern)?.[0]).find(Boolean) || "";

  let allowOnce = false;
  function guard(event) {
    if (allowOnce) { allowOnce = false; return; }
    const input = $("#messageInput");
    const secret = input ? findSecret(input.value) : "";
    if (!secret) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const root = modal(`<div class="kz-cx-guard"><span class="kz-cx-icon is-big is-warn">${LOCK}</span><h2>Isso parece uma senha ou chave</h2><p>Segredos não devem ir pelo chat. Use o cartão seguro: a credencial vai cifrada direto para o servidor e nunca aparece para a IA.</p><div class="kz-cx-actions is-stack"><button class="kz-cx-btn is-primary" type="button" data-guard="card">${LOCK}<span>Usar cartão seguro</span></button><button class="kz-cx-btn" type="button" data-guard="strip">Enviar sem o segredo</button></div><small>Se já compartilhou essa chave em outro lugar, revogue-a no site oficial.</small></div>`, "is-guard");
    root.addEventListener("click", (clickEvent) => {
      const action = clickEvent.target.closest("[data-guard]")?.dataset.guard;
      if (!action) return;
      root.remove();
      let text = input.value;
      let match;
      while ((match = findSecret(text))) text = text.replace(match, "[segredo removido]");
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (action === "card") {
        if (!text.replace(/\[segredo removido\]/g, "").trim()) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
        openRequest();
        return;
      }
      allowOnce = true;
      $("#sendButton")?.click();
    });
  }
  $("#sendButton")?.addEventListener("click", guard, true);
  $("#messageInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && findSecret(event.target.value)) guard(event);
  }, true);
})();
