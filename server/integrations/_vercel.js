/*
 * KAZER — conector Vercel.
 * A pessoa cola um token de acesso (vercel.com/account/tokens). O token é
 * validado na API da Vercel, cifrado e usado somente pelo backend.
 * Chat normal: leitura de projetos e deploys. Modo Computer: também redeploy.
 */
const { decryptSecret, encryptSecret, requireUser, supabaseRequest, unauthorized, badRequest } = require("../storage/_kazer-data");
const { sendJson } = require("../security/_security");

const TABLE = "kazer_vercel_connections";
const TEAM_PATTERN = /^team_[A-Za-z0-9]{6,64}$/;

async function vercelFetch(path, token, { teamId, method = "GET", body } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || "vercel_request_failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getVercelConnection(userId) {
  const rows = await supabaseRequest(TABLE, { query: { select: "*", user_id: `eq.${userId}`, limit: 1 } });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function vercelToken(row) {
  const value = decryptSecret(row?.access_token_encrypted);
  return typeof value === "string" ? value : "";
}

function connectionForClient(row) {
  return row ? { connected: true, username: row.username, displayName: row.display_name || row.username, teamId: row.team_id || null, connectedAt: row.created_at } : { connected: false };
}

function projectForClient(project) {
  const latest = project.latestDeployments?.[0] || null;
  return {
    id: project.id,
    name: project.name,
    framework: project.framework || null,
    updatedAt: project.updatedAt || null,
    url: latest?.url ? `https://${latest.url}` : null,
    state: latest?.readyState || null,
  };
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

async function handler(request, response) {
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);

  try {
    if (request.method === "GET") {
      const row = await getVercelConnection(user.id);
      if (!row) return sendJson(response, 200, { connection: { connected: false }, projects: [] });
      let projects = [];
      try {
        const data = await vercelFetch("/v9/projects?limit=30", vercelToken(row), { teamId: row.team_id });
        projects = (data?.projects || []).map(projectForClient);
      } catch (error) {
        if (error.status === 401 || error.status === 403) return sendJson(response, 200, { connection: { ...connectionForClient(row), expired: true }, projects: [] });
      }
      return sendJson(response, 200, { connection: connectionForClient(row), projects });
    }

    if (request.method === "DELETE") {
      await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { success: true });
    }

    const body = parseBody(request);
    if (!body) return badRequest(response, "JSON inválido.");
    const token = String(body.token || "").trim();
    const teamId = String(body.teamId || "").trim();
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return badRequest(response, "Token da Vercel inválido.");
    if (teamId && !TEAM_PATTERN.test(teamId)) return badRequest(response, "ID de time inválido (formato team_…).");

    let account;
    try {
      account = (await vercelFetch("/v2/user", token))?.user;
      if (teamId) await vercelFetch(`/v2/teams/${encodeURIComponent(teamId)}`, token);
    } catch {
      return badRequest(response, "A Vercel recusou este token. Confira o token e o escopo.");
    }
    if (!account?.id) return badRequest(response, "A Vercel não retornou a conta.");

    const payload = {
      user_id: user.id,
      vercel_user_id: String(account.id),
      username: String(account.username || account.email || "vercel").slice(0, 120),
      display_name: account.name ? String(account.name).slice(0, 120) : null,
      team_id: teamId || null,
      access_token_encrypted: encryptSecret(token),
    };
    await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}` } });
    const rows = await supabaseRequest(TABLE, { method: "POST", body: payload });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return sendJson(response, 201, { connection: connectionForClient(row || payload) });
  } catch (error) {
    console.error("Vercel connector error", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível concluir a operação com a Vercel." });
  }
}

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } },
});

const READ_TOOLS = [
  fn("vercel_list_projects", "Lista os projetos da Vercel conectada."),
  fn("vercel_list_deployments", "Lista deploys recentes de um projeto da Vercel.", { project: { type: "string", description: "Nome ou ID do projeto." } }, ["project"]),
  fn("vercel_deployment_logs", "Lê os eventos de build de um deploy da Vercel.", { deploymentId: { type: "string" } }, ["deploymentId"]),
];
const WRITE_TOOLS = [
  fn("vercel_redeploy", "MODO COMPUTER. Refaz um deploy existente da Vercel.", { deploymentId: { type: "string" }, production: { type: "boolean" } }, ["deploymentId"]),
];
const READ_NAMES = new Set(READ_TOOLS.map((tool) => tool.function.name));
const WRITE_NAMES = new Set(WRITE_TOOLS.map((tool) => tool.function.name));
const ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function vercelToolDefinitions({ computer = false } = {}) {
  return computer ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
}

function isVercelTool(name) { return READ_NAMES.has(name) || WRITE_NAMES.has(name); }
function isVercelWriteTool(name) { return WRITE_NAMES.has(name); }

async function createVercelSession(userId) {
  const row = await getVercelConnection(userId).catch(() => null);
  const token = vercelToken(row);
  return token ? { token, teamId: row.team_id || undefined } : null;
}

async function executeVercelTool(session, name, args = {}, { computer = false } = {}) {
  if (!session) throw new Error("Conecte a Vercel em Conectores.");
  if (WRITE_NAMES.has(name) && !computer) throw new Error("Deploys só são permitidos no modo Computer.");
  const options = { teamId: session.teamId };
  switch (name) {
    case "vercel_list_projects": {
      const data = await vercelFetch("/v9/projects?limit=30", session.token, options);
      return (data?.projects || []).map(projectForClient);
    }
    case "vercel_list_deployments": {
      const project = String(args.project || "");
      if (!ID_PATTERN.test(project)) throw new Error("Projeto inválido.");
      const info = await vercelFetch(`/v9/projects/${encodeURIComponent(project)}`, session.token, options);
      const data = await vercelFetch(`/v6/deployments?projectId=${encodeURIComponent(info.id)}&limit=10`, session.token, options);
      return (data?.deployments || []).map((item) => ({ id: item.uid, url: item.url ? `https://${item.url}` : null, state: item.state || item.readyState, target: item.target || "preview", createdAt: item.created, commit: item.meta?.githubCommitMessage?.slice(0, 160) || null }));
    }
    case "vercel_deployment_logs": {
      const id = String(args.deploymentId || "");
      if (!ID_PATTERN.test(id)) throw new Error("Deploy inválido.");
      const data = await vercelFetch(`/v3/deployments/${encodeURIComponent(id)}/events?limit=120`, session.token, options);
      const events = Array.isArray(data) ? data : [];
      return events.map((event) => String(event?.payload?.text || event?.text || "")).filter(Boolean).slice(-120).join("\n").slice(-12000);
    }
    case "vercel_redeploy": {
      const id = String(args.deploymentId || "");
      if (!ID_PATTERN.test(id)) throw new Error("Deploy inválido.");
      const original = await vercelFetch(`/v13/deployments/${encodeURIComponent(id)}`, session.token, options);
      const data = await vercelFetch("/v13/deployments", session.token, {
        ...options,
        method: "POST",
        body: { name: original.name, deploymentId: original.id, ...(args.production ? { target: "production" } : {}) },
      });
      return { redeployed: true, id: data?.id, url: data?.url ? `https://${data.url}` : null };
    }
    default:
      throw new Error("Ferramenta Vercel desconhecida.");
  }
}

const VERCEL_ACTION_LABELS = {
  vercel_list_projects: "Leu projetos Vercel",
  vercel_list_deployments: "Leu deploys",
  vercel_deployment_logs: "Leu logs de build",
  vercel_redeploy: "Refez deploy",
};

module.exports = {
  VERCEL_ACTION_LABELS,
  createVercelSession,
  executeVercelTool,
  getVercelConnection,
  handler,
  isVercelTool,
  isVercelWriteTool,
  vercelToolDefinitions,
};
