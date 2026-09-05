(() => {
  "use strict";

  const SUPABASE_URL = "https://mqjunopzycdezzjmlhip.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtcWp1bm9wenljZGV6enptbGhpcCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg3ODM4NzQ5LCJleHAiOjIxMDM0MTQ3NDl9.Y_o2_QhZzuCjvHdEfxaR5VrAxo7NFenPaDmdHN3bwM";
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  };
  const state = { tab: "tasks", tasks: [], repos: [], reposLoaded: false, selectedRepo: null, connectors: [], presets: [], github: { connected: false }, mcpModal: null, pendingTasks: new Map() };
  const content = $("#workspaceContent");
  const workspace = $("#workspacePanel");
  const toggle = $("#workspaceToggle");
  const statusLabel = $("#githubProfileStatus");

  async function authHeaders() {
    const result = await supabase?.auth.getSession();
    const token = result?.data?.session?.access_token;
    if (!token) throw new Error("Sessão inválida ou expirada.");
    return { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), ...await authHeaders() } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }

  function notify(message) {
    if (typeof window.kazerShowToast === "function") window.kazerShowToast(message);
    else {
      const toast = $("#toast");
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("visible");
      window.setTimeout(() => toast.classList.remove("visible"), 2300);
    }
  }

  function closeAttachmentSheet() {
    const sheet = $("#attachmentSheet");
    const backdrop = $("#attachmentBackdrop");
    if (!sheet || !backdrop) return;
    sheet.classList.remove("visible");
    backdrop.classList.remove("visible");
    sheet.setAttribute("aria-hidden", "true");
    sheet.hidden = true;
    backdrop.hidden = true;
    $("#attachButton")?.setAttribute("aria-expanded", "false");
  }

  function openWorkspace(tab = state.tab) {
    state.tab = tab;
    workspace?.classList.add("visible");
    workspace?.setAttribute("aria-hidden", "false");
    toggle?.setAttribute("aria-expanded", "true");
    renderWorkspace();
    if (tab === "tasks") refreshTasks();
    if (tab === "repos") refreshRepos();
  }

  function closeWorkspace() {
    workspace?.classList.remove("visible");
    workspace?.setAttribute("aria-hidden", "true");
    toggle?.setAttribute("aria-expanded", "false");
  }

  function statusText(status) {
    return ({ pending: "Aguardando", processing: "Em andamento", completed: "Concluída", error: "Falhou", stopped: "Parada" })[status] || status || "Aguardando";
  }

  function repoFromUrl(value) {
    try { return new URL(value).pathname.split("/").filter(Boolean).slice(0, 2).join("/"); } catch { return "Sem repositório"; }
  }

  const CONNECTOR_REQUEST_PATTERN = /\b(?:github|git hub|reposit[oó]rio|repos?|branch|commit|pull request|merge|issue|bug|c[oó]digo|projeto|deploy|mcp|conector|integra[cç][aã]o|conectar|servidor|arquivo no github)\b/i;
  function isConnectorRequest(prompt) { return CONNECTOR_REQUEST_PATTERN.test(String(prompt || "")); }
  function isConnectorTask(task) {
    return Boolean(task?.connectorContext || task?.taskType === "connector" || task?.repoUrl || task?.repoFullName || (Array.isArray(task?.mcpConnectorIds) && task.mcpConnectorIds.length));
  }
  function repoForPrompt(prompt) {
    const source = String(prompt || "").toLocaleLowerCase();
    const exact = state.repos.find((repo) => {
      const fullName = String(repo.fullName || "").toLocaleLowerCase();
      const name = String(repo.name || "").toLocaleLowerCase();
      return (fullName && source.includes(fullName)) || (name && new RegExp(`(?:^|[^\\w-])${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:$|[^\\w-])`, "i").test(source));
    });
    return exact || (state.selectedRepo && isConnectorRequest(prompt) ? state.selectedRepo : null);
  }
  function taskRepositoryLabel(task) { return task?.repoFullName || repoFromUrl(task?.repoUrl); }

  function renderWorkspace() {
    if (!content) return;
    document.querySelectorAll("[data-workspace-tab]").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTab === state.tab));
    if (state.tab === "repos") {
      content.innerHTML = `<div class="workspace-toolbar"><input class="workspace-search" id="workspaceRepoSearch" type="search" placeholder="Buscar repositórios..." autocomplete="off"><button class="workspace-action" id="workspaceRepoRefresh" type="button" aria-label="Atualizar repositórios">↻</button></div><div id="workspaceRepoList"></div>`;
      $("#workspaceRepoSearch")?.addEventListener("input", () => renderRepos($("#workspaceRepoSearch").value));
      $("#workspaceRepoRefresh")?.addEventListener("click", () => refreshRepos(true));
      renderRepos();
      return;
    }
    content.innerHTML = `<div class="workspace-toolbar"><span class="workspace-section-label">Atividades recentes</span><button class="workspace-action" id="workspaceTaskRefresh" type="button" aria-label="Atualizar tarefas">↻</button></div><div id="workspaceTaskList"></div>`;
    $("#workspaceTaskRefresh")?.addEventListener("click", () => refreshTasks(true));
    renderTasks();
  }

  function renderTasks() {
    const list = $("#workspaceTaskList");
    if (!list) return;
    const connectorTasks = state.tasks.filter(isConnectorTask);
    if (!connectorTasks.length) {
      list.innerHTML = `<div class="workspace-empty">As tarefas aparecem aqui somente quando o KAZER trabalha com GitHub, repositórios ou conectores.</div>`;
      return;
    }
    list.innerHTML = connectorTasks.slice(0, 30).map((task) => {
      const status = String(task.status || "pending");
      const mcpCount = Array.isArray(task.mcpConnectorIds) ? task.mcpConnectorIds.length : 0;
      const repository = taskRepositoryLabel(task);
      return `<article class="workspace-card"><div class="workspace-card-head"><strong class="workspace-card-title">${escapeHtml(task.title || task.prompt)}</strong><span class="workspace-status ${escapeHtml(status)}">${escapeHtml(statusText(status))}</span></div><div class="workspace-card-meta">${escapeHtml(repository === "Sem repositório" ? "Operação de conector" : repository)} · ${escapeHtml(formatDate(task.createdAt))}${mcpCount ? ` · ${mcpCount} MCP${mcpCount > 1 ? "s" : ""}` : ""}</div><div class="workspace-progress" aria-label="${Number(task.progress || 0)}%"><span style="width:${Math.max(0, Math.min(100, Number(task.progress || 0)))}%"></span></div>${task.creditCost ? `<div class="workspace-card-meta">Custo desta tarefa: ${Number(task.creditCost)} créditos</div>` : ""}</article>`;
    }).join("");
  }

  function renderRepos(search = "") {
    const list = $("#workspaceRepoList");
    if (!list) return;
    if (!state.github.connected) {
      list.innerHTML = `<div class="workspace-empty">Conecte o GitHub no Perfil para ver os repositórios disponíveis.</div>`;
      return;
    }
    const query = String(search || "").trim().toLocaleLowerCase();
    const repos = state.repos.filter((repo) => !query || `${repo.fullName} ${repo.description}`.toLocaleLowerCase().includes(query));
    if (!repos.length) {
      list.innerHTML = `<div class="workspace-empty">${query ? `Nenhum repositório corresponde a “${escapeHtml(query)}”.` : "Nenhum repositório encontrado."}</div>`;
      return;
    }
    list.innerHTML = repos.map((repo) => `<button class="workspace-repo${state.selectedRepo?.id && String(state.selectedRepo.id) === String(repo.id) ? " selected" : ""}" type="button" data-repo-id="${escapeHtml(String(repo.id))}"><span class="workspace-repo-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .7a11.3 11.3 0 0 0-3.58 21.99c.57.1.78-.25.78-.55v-2.12c-3.17.69-3.84-1.53-3.84-1.53-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.53-2.53-.29-5.2-1.26-5.2-5.62 0-1.24.44-2.25 1.18-3.04-.12-.29-.51-1.44.11-3 0 0 .96-.3 3.12 1.16a10.8 10.8 0 0 1 5.68 0c2.16-1.46 3.12-1.16 3.12-1.16.62 1.56.23 2.71.12 3 .73.79 1.17 1.8 1.17 3.04 0 4.37-2.68 5.32-5.23 5.61.41.36.78 1.07.78 2.16v3.2c0 .31.2.66.79.55A11.3 11.3 0 0 0 12 .7Z"></path></svg></span><span class="workspace-repo-copy"><strong>${escapeHtml(repo.fullName)}</strong><small>${escapeHtml(repo.description || repo.language || "Repositório GitHub")}</small></span>${repo.private ? `<span class="workspace-private">Privado</span>` : ""}</button>`).join("");
    list.querySelectorAll("[data-repo-id]").forEach((button) => button.addEventListener("click", () => {
      const repo = state.repos.find((item) => String(item.id) === String(button.dataset.repoId));
      if (!repo) return;
      state.selectedRepo = repo;
      window.kazerSelectedRepository = repo;
      closeWorkspace();
      notify(`Repositório ${repo.fullName} selecionado; descreva o que deseja fazer`);
    }));
  }

  async function refreshTasks(showLoading = false) {
    const list = $("#workspaceTaskList");
    if (showLoading && list) list.innerHTML = `<div class="workspace-loading">Atualizando tarefas…</div>`;
    try {
      const data = await api("/api/tasks");
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      renderTasks();
    } catch (error) {
      if (list) list.innerHTML = `<div class="workspace-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function refreshRepos(force = false) {
    const list = $("#workspaceRepoList");
    if (state.reposLoaded && !force) { renderRepos($("#workspaceRepoSearch")?.value || ""); return; }
    if (list) list.innerHTML = `<div class="workspace-loading">Carregando repositórios…</div>`;
    try {
      const data = await api("/api/github-repos?page=1&per_page=50");
      state.repos = Array.isArray(data.repos) ? data.repos : [];
      state.reposLoaded = true;
      renderRepos($("#workspaceRepoSearch")?.value || "");
    } catch (error) {
      if (list) list.innerHTML = `<div class="workspace-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadGitHubStatus() {
    try {
      const data = await api("/api/github-status");
      state.github = data.connection || { connected: false };
      if (statusLabel) statusLabel.textContent = state.github.connected ? `Conectado como ${state.github.login}` : "Conectar repositórios";
      if (state.github.connected) refreshRepos();
      if (state.tab === "repos" && workspace?.classList.contains("visible")) renderRepos();
    } catch {
      state.github = { connected: false };
      if (statusLabel) statusLabel.textContent = "Conectar repositórios";
    }
  }

  async function connectGitHub() {
    try {
      const data = await api("/api/github-connect");
      if (!data.url) throw new Error("GitHub OAuth não configurado.");
      window.location.assign(data.url);
    } catch (error) { notify(error.message); }
  }

  async function disconnectGitHub() {
    if (!window.confirm("Desconectar o GitHub deste KAZER?")) return;
    try {
      await api("/api/github-disconnect", { method: "DELETE" });
      state.github = { connected: false };
      state.repos = [];
      state.reposLoaded = false;
      if (statusLabel) statusLabel.textContent = "Conectar repositórios";
      renderRepos();
      notify("GitHub desconectado");
    } catch (error) { notify(error.message); }
  }

  function openMcpModal(editing = null) {
    closeAttachmentSheet();
    state.mcpModal = { editing, view: editing ? "form" : "list" };
    renderMcpModal();
  }

  function closeMcpModal() {
    const root = $("#mcpModalRoot");
    root?.remove();
    state.mcpModal = null;
  }

  function mcpIcon(name) {
    if (typeof window.kazerConnectorIcon === "function") return window.kazerConnectorIcon(name);
    return `<span class="profile-integration-icon mcp-brand-icon generic" aria-hidden="true">+</span>`;
  }

  async function loadConnectors() {
    try {
      const data = await api("/api/mcp");
      state.connectors = Array.isArray(data.connectors) ? data.connectors : [];
      state.presets = Array.isArray(data.presets) ? data.presets : [];
      window.kazerMcpSelection = state.connectors.filter((connector) => connector.status === "connected").map((connector) => connector.id);
      updateMcpBadge();
      if (state.mcpModal) renderMcpModal();
    } catch (error) {
      state.connectors = [];
      if (state.mcpModal) renderMcpModal(error.message);
    }
  }

  function updateMcpBadge() {
    const badge = $("#mcpProfileStatus");
    if (!badge) return;
    const count = state.connectors.filter((connector) => connector.status === "connected").length;
    badge.textContent = count ? `${count} conectado${count > 1 ? "s" : ""}` : "Conectores prontos";
  }

  function renderMcpModal(errorMessage = "") {
    let root = $("#mcpModalRoot");
    if (!root) { root = document.createElement("div"); root.id = "mcpModalRoot"; document.body.appendChild(root); }
    const modal = state.mcpModal || { view: "list" };
    const title = modal.view === "form" ? (modal.editing ? "Editar MCP" : "Adicionar MCP") : "MCPs conectados";
    root.innerHTML = `<div class="mcp-modal-backdrop" role="presentation"><section class="mcp-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="mcp-modal-head"><div><h2>${escapeHtml(title)}</h2><p>Conecte ferramentas externas ao KAZER sem expor suas credenciais.</p></div><button class="mcp-modal-close" id="mcpModalClose" type="button" aria-label="Fechar">×</button></header><div class="mcp-modal-body" id="mcpModalBody">${errorMessage ? `<div class="workspace-empty">${escapeHtml(errorMessage)}</div>` : ""}</div></section></div>`;
    $("#mcpModalClose")?.addEventListener("click", closeMcpModal);
    $(".mcp-modal-backdrop")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeMcpModal(); });
    const body = $("#mcpModalBody");
    if (errorMessage || !body) return;
    if (modal.view === "form") renderMcpForm(body, modal.editing);
    else renderMcpList(body);
  }

  function renderMcpList(body) {
    const connected = state.connectors.filter((connector) => connector.status === "connected").length;
    body.innerHTML = `<span class="mcp-section-label">${connected} ativo${connected === 1 ? "" : "s"}</span>${state.connectors.length ? state.connectors.map((connector) => `<div class="mcp-connector-row">${mcpIcon(connector.name)}<div class="mcp-connector-copy"><strong>${escapeHtml(connector.name)}</strong><small>${escapeHtml(connector.baseUrl || connector.command || "Conector configurado")}</small></div><div class="mcp-connector-actions"><button class="mcp-small-button" type="button" data-mcp-edit="${escapeHtml(connector.id)}">Editar</button><button class="mcp-small-button" type="button" data-mcp-toggle="${escapeHtml(connector.id)}">${connector.status === "connected" ? "Desligar" : "Ligar"}</button><button class="mcp-small-button danger" type="button" data-mcp-delete="${escapeHtml(connector.id)}">Excluir</button></div></div>`).join("") : `<div class="workspace-empty">Nenhum conector conectado. Escolha uma opção pronta abaixo ou adicione um servidor personalizado.</div>`}<div class="mcp-presets-grid">${state.presets.map((preset) => `<button class="mcp-preset-card" type="button" data-mcp-preset="${escapeHtml(preset.name)}">${mcpIcon(preset.name)}<strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.type === "local" ? "Local / STDIO" : "Remoto / HTTP")}</small></button>`).join("")}</div><div class="mcp-form-actions"><button class="mcp-secondary-button" id="mcpAddCustom" type="button">Adicionar personalizado</button></div>`;
    body.querySelectorAll("[data-mcp-edit]").forEach((button) => button.addEventListener("click", () => openMcpModal(state.connectors.find((item) => item.id === button.dataset.mcpEdit) || null)));
    body.querySelectorAll("[data-mcp-toggle]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      const connector = state.connectors.find((item) => item.id === button.dataset.mcpToggle);
      try { await api("/api/mcp", { method: "PATCH", body: JSON.stringify({ id: connector.id, action: "toggle", status: connector.status === "connected" ? "disconnected" : "connected" }) }); await loadConnectors(); notify("Estado do MCP atualizado"); } catch (error) { notify(error.message); } finally { button.disabled = false; }
    }));
    body.querySelectorAll("[data-mcp-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Excluir este MCP?")) return;
      try { await api(`/api/mcp?id=${encodeURIComponent(button.dataset.mcpDelete)}`, { method: "DELETE", body: JSON.stringify({ id: button.dataset.mcpDelete }) }); await loadConnectors(); notify("MCP excluído"); } catch (error) { notify(error.message); }
    }));
    body.querySelectorAll("[data-mcp-preset]").forEach((button) => button.addEventListener("click", () => openMcpModal(state.presets.find((item) => item.name === button.dataset.mcpPreset) || null)));
    $("#mcpAddCustom")?.addEventListener("click", () => openMcpModal({ custom: true, type: "remote" }));
  }

  function renderMcpForm(body, initial) {
    const preset = initial && !initial.custom && !initial.id ? initial : null;
    const editing = initial?.id ? initial : null;
    const type = editing?.type || preset?.type || initial?.type || "remote";
    body.innerHTML = `<form class="mcp-form" id="mcpForm"><label>Nome<input name="name" required maxlength="120" value="${escapeHtml(editing?.name || preset?.name || "")}" placeholder="Meu MCP"></label><label>Tipo<select name="type"><option value="remote" ${type === "remote" ? "selected" : ""}>Remoto (HTTPS)</option><option value="local" ${type === "local" ? "selected" : ""}>Local (STDIO)</option></select></label><label data-mcp-url-field>URL HTTPS<input name="baseUrl" type="url" value="${escapeHtml(editing?.baseUrl || preset?.baseUrl || "")}" placeholder="https://servidor.exemplo/mcp" ${type === "remote" ? "required" : ""}></label><label data-mcp-command-field>Comando local<input name="command" value="${escapeHtml(editing?.command || preset?.command || "")}" placeholder="npx -y pacote-mcp" ${type === "local" ? "required" : ""}></label><label>Descrição<textarea name="description" maxlength="500" placeholder="Para que este MCP será usado?">${escapeHtml(editing?.description || "")}</textarea></label><label>Variáveis de ambiente (JSON)<textarea name="env" placeholder='{"API_KEY":"sua-chave"}' spellcheck="false"></textarea></label><label>ID OAuth (opcional)<input name="oauthClientId" autocomplete="off"></label><label>Segredo OAuth (opcional)<input name="oauthClientSecret" type="password" autocomplete="new-password"></label><div class="mcp-form-actions"><button class="mcp-secondary-button" id="mcpFormBack" type="button">Voltar</button><button class="mcp-primary-button" type="submit">${editing ? "Salvar alterações" : "Conectar MCP"}</button></div></form>`;
    const form = $("#mcpForm");
    const typeSelect = form.querySelector("[name=type]");
    const syncType = () => { const local = typeSelect.value === "local"; form.querySelector("[data-mcp-url-field]").hidden = local; form.querySelector("[data-mcp-command-field]").hidden = !local; form.querySelector("[name=baseUrl]").required = !local; form.querySelector("[name=command]").required = local; };
    typeSelect.addEventListener("change", syncType); syncType();
    $("#mcpFormBack")?.addEventListener("click", () => { state.mcpModal.view = "list"; state.mcpModal.editing = null; renderMcpModal(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const rawEnv = String(formData.get("env") || "").trim();
      let env = {};
      if (rawEnv) { try { env = JSON.parse(rawEnv); } catch { notify("As variáveis de ambiente precisam ser um JSON válido."); return; } }
      const payload = { id: editing?.id, name: formData.get("name"), type: formData.get("type"), baseUrl: formData.get("baseUrl"), command: formData.get("command"), description: formData.get("description"), env, oauthClientId: formData.get("oauthClientId"), oauthClientSecret: formData.get("oauthClientSecret"), keepSecrets: Boolean(editing) };
      const button = form.querySelector("[type=submit]"); button.disabled = true;
      try { await api("/api/mcp", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }); await loadConnectors(); notify(editing ? "MCP atualizado" : "MCP conectado"); state.mcpModal.view = "list"; state.mcpModal.editing = null; renderMcpModal(); } catch (error) { notify(error.message); } finally { button.disabled = false; }
    });
  }

  function startTask({ prompt, attachmentCount = 0 } = {}) {
    const mcpConnectorIds = Array.isArray(window.kazerMcpSelection) ? window.kazerMcpSelection : [];
    const repository = repoForPrompt(prompt);
    const connectorIntent = isConnectorRequest(prompt);
    const connectorContext = connectorIntent && (Boolean(repository) || mcpConnectorIds.length > 0);
    if (!connectorContext) return null;
    const clientId = window.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const promise = api("/api/tasks", { method: "POST", body: JSON.stringify({ title: String(prompt || "").slice(0, 72), prompt, taskType: repository ? "coding" : "chat", status: "processing", progress: 15, repoUrl: repository?.htmlUrl || repository?.cloneUrl || null, mcpConnectorIds, logs: [{ type: "info", message: "Operação de conector iniciada no chat" }], creditCost: 0 }) }).then((data) => data.task);
    state.pendingTasks.set(clientId, promise);
    promise.then((task) => { if (task) state.tasks = [task, ...state.tasks.filter((item) => item.id !== task.id)]; if (workspace?.classList.contains("visible") && state.tab === "tasks") renderTasks(); }).catch(() => {});
    return { id: clientId, mcpConnectorIds, attachmentCount, connectorContext: true, repo: repository || null };
  }

  async function updateTask(context, patch) {
    if (!context?.id) return;
    try {
      const task = await state.pendingTasks.get(context.id);
      if (!task?.id) return;
      const data = await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, ...patch }) });
      if (data.task) state.tasks = [data.task, ...state.tasks.filter((item) => item.id !== data.task.id)];
      if (workspace?.classList.contains("visible") && state.tab === "tasks") renderTasks();
    } catch {}
    state.pendingTasks.delete(context.id);
  }

  window.kazerWorkspace = {
    startTask,
    finishTask: (context, result, creditCost) => updateTask(context, { status: "completed", progress: 100, result: String(result || "").slice(0, 16000), creditCost: Number(creditCost) || 0, logs: [{ type: "success", message: "Tarefa concluída" }] }),
    failTask: (context, error) => updateTask(context, { status: "error", progress: 100, error: String(error || "Falha na tarefa").slice(0, 2000), logs: [{ type: "error", message: String(error || "Falha na tarefa").slice(0, 1000) }] }),
    stopTask: (context) => updateTask(context, { status: "stopped", progress: 100, error: "Resposta interrompida pelo usuário.", logs: [{ type: "info", message: "Tarefa interrompida pelo usuário" }] }),
    refresh: refreshTasks,
  };

  toggle?.addEventListener("click", () => workspace?.classList.contains("visible") ? closeWorkspace() : openWorkspace());
  $("#workspaceClose")?.addEventListener("click", closeWorkspace);
  $("#mobileWorkspaceButton")?.addEventListener("click", () => openWorkspace("tasks"));
  $("#mcpProfileAction")?.addEventListener("click", () => openMcpModal());
  $("#githubProfileAction")?.addEventListener("click", () => state.github.connected ? notify(`GitHub conectado como ${state.github.login}`) : connectGitHub());
  document.querySelectorAll("[data-workspace-tab]").forEach((button) => button.addEventListener("click", () => openWorkspace(button.dataset.workspaceTab)));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMcpModal(); closeWorkspace(); } });
  window.addEventListener("kazer:github-disconnect", disconnectGitHub);

  loadGitHubStatus();
  loadConnectors();
  if (new URLSearchParams(window.location.search).get("github") === "connected") notify("GitHub conectado ao KAZER");
})();
