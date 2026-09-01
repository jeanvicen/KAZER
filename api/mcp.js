const net = require("node:net");
const {
  badRequest,
  connectorForClient,
  encryptSecret,
  requireUser,
  supabaseRequest,
  unauthorized,
} = require("./_kazer-data");
const { sendJson } = require("./_security");

const PRESETS = [
  { name: "Browserbase", type: "local", command: "npx @browserbasehq/mcp", envKeys: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "Context7", type: "remote", baseUrl: "https://mcp.context7.com/mcp" },
  { name: "Convex", type: "local", command: "npx -y convex@latest mcp start" },
  { name: "Figma", type: "remote", baseUrl: "https://mcp.figma.com/mcp" },
  { name: "Hugging Face", type: "remote", baseUrl: "https://hf.co/mcp" },
  { name: "Linear", type: "remote", baseUrl: "https://mcp.linear.app/sse" },
  { name: "Notion", type: "remote", baseUrl: "https://mcp.notion.com/mcp" },
  { name: "Playwright", type: "local", command: "npx -y @playwright/mcp@latest" },
  { name: "Supabase", type: "remote", baseUrl: "https://mcp.supabase.com/mcp" },
];

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

function cleanText(value, maximum = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const version = net.isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168;
  }
  if (version === 6) return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  return false;
}

function validateUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.hash || isPrivateHost(url.hostname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function normalizeEnv(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    const safeKey = String(key).trim().replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80);
    const safeValue = String(item ?? "").slice(0, 4000);
    if (safeKey && safeValue) result[safeKey] = safeValue;
  }
  return result;
}

function safeError(response, error) {
  console.error("MCP endpoint error", error?.message || "unknown");
  return sendJson(response, error?.status === 503 ? 503 : 500, {
    error: error?.status === 503 ? "A integração com o Supabase não está configurada no servidor." : "Não foi possível concluir a operação do MCP.",
  });
}

module.exports = async function handler(request, response) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }

  const user = await requireUser(request);
  if (!user) return unauthorized(response);

  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest("kazer_mcp_connectors", {
        query: { select: "id,name,description,type,base_url,command,status,secret_payload,created_at,updated_at", user_id: `eq.${user.id}`, order: "updated_at.desc" },
      });
      return sendJson(response, 200, {
        presets: PRESETS,
        connectors: (Array.isArray(rows) ? rows : []).map(connectorForClient),
      });
    }

    const body = parseBody(request);
    if (!body || typeof body !== "object") return badRequest(response, "JSON inválido.");
    const id = cleanText(body.id, 80);

    if (request.method === "DELETE") {
      if (!id) return badRequest(response, "MCP inválido.");
      await supabaseRequest("kazer_mcp_connectors", { method: "DELETE", query: { id: `eq.${id}`, user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { success: true });
    }

    if (request.method === "PATCH" && body.action === "toggle") {
      if (!id || !["connected", "disconnected"].includes(body.status)) return badRequest(response, "Estado do MCP inválido.");
      const rows = await supabaseRequest("kazer_mcp_connectors", {
        method: "PATCH",
        query: { id: `eq.${id}`, user_id: `eq.${user.id}` },
        body: { status: body.status },
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return sendJson(response, 200, { connector: row ? connectorForClient(row) : null });
    }

    const name = cleanText(body.name, 120);
    const type = body.type === "local" ? "local" : "remote";
    const baseUrl = type === "remote" ? validateUrl(body.baseUrl) : null;
    const command = type === "local" ? cleanText(body.command, 500) : null;
    if (!name) return badRequest(response, "Informe um nome para o MCP.");
    if (type === "remote" && !baseUrl) return badRequest(response, "Informe uma URL HTTPS válida para o MCP remoto.");
    if (type === "local" && !command) return badRequest(response, "Informe o comando do MCP local.");

    const env = normalizeEnv(body.env);
    if (env === null) return badRequest(response, "As variáveis do MCP devem ser um objeto.");
    const existingSecret = id ? body.keepSecrets === true : false;
    const secretPayload = Object.keys(env).length || body.oauthClientId || body.oauthClientSecret
      ? encryptSecret({ env, oauthClientId: cleanText(body.oauthClientId, 300), oauthClientSecret: cleanText(body.oauthClientSecret, 1000) })
      : existingSecret ? undefined : null;

    const payload = {
      user_id: user.id,
      name,
      description: cleanText(body.description, 500) || null,
      type,
      base_url: baseUrl,
      command,
    };
    if (!id || body.status !== undefined) payload.status = body.status === "disconnected" ? "disconnected" : "connected";
    if (secretPayload !== undefined) payload.secret_payload = secretPayload;

    const rows = await supabaseRequest("kazer_mcp_connectors", {
      method: id ? "PATCH" : "POST",
      query: id ? { id: `eq.${id}`, user_id: `eq.${user.id}` } : undefined,
      body: payload,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return sendJson(response, id ? 200 : 201, { connector: row ? connectorForClient(row) : null });
  } catch (error) {
    return safeError(response, error);
  }
};

module.exports.PRESETS = PRESETS;
