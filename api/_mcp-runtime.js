const crypto = require("node:crypto");
const { connectorSecretPayload, supabaseRequest } = require("./_kazer-data");
const { readTextWithLimit } = require("./_security");
const { canonicalJson, sanitizeMcpInputSchema, validateMcpArguments } = require("./_mcp-schema");

const { parsePublicUrl, requestPublicUrl } = require("./_ssrf");
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_SERVERS = 8;
const MAX_TOOLS_PER_SERVER = 24;
const MAX_TOTAL_TOOLS = 48;
const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;

function safeErrorFields(error) {
  const status = Number.isInteger(error?.status) && error.status >= 0 && error.status <= 599 ? error.status : 0;
  const code = typeof error?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(error.code) ? error.code : undefined;
  return { status, ...(code ? { code } : {}) };
}

function safeText(value, maximum = 1200) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, maximum);
}

function jsonRpcBody(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

async function readRpcResponse(response) {
  const text = await readTextWithLimit(response, MAX_RPC_RESPONSE_BYTES);
  if (!text) return null;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try { return JSON.parse(text); } catch { return null; }
  }
  const events = text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(events[index].slice(5).trim()); } catch {}
  }
  try { return JSON.parse(text); } catch { return null; }
}

function buildHeaders(secret) {
  const env = secret?.env && typeof secret.env === "object" ? secret.env : {};
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const authorization = env.Authorization || env.AUTHORIZATION || (env.MCP_AUTH_TOKEN ? `Bearer ${env.MCP_AUTH_TOKEN}` : "");
  if (authorization) headers.Authorization = String(authorization).slice(0, 2000);
  if (env["X-Api-Key"]) headers["X-Api-Key"] = String(env["X-Api-Key"]).slice(0, 1000);
  return headers;
}

function validateToolSchema(schema) {
  return sanitizeMcpInputSchema(schema);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}

function mcpRuntimeFingerprint(servers) {
  const stable = (Array.isArray(servers) ? servers : []).map((server) => ({
    id: server.id,
    config: server.configFingerprint,
    tools: (server.tools || []).map((tool) => ({ name: tool.name, schema: fingerprint(tool.inputSchema), description: tool.description })),
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return fingerprint(stable);
}

function isAllowedRemoteUrl(value) {
  try {
    parsePublicUrl(value, { protocols: ["https:"], allowCustomPort: true });
    return true;
  } catch { return false; }
}

async function mcpRequest(server, method, params, id) {
  if (!isAllowedRemoteUrl(server?.url)) throw new Error("MCP URL não permitida");
  const headers = { ...server.headers };
  if (server.sessionId) headers["Mcp-Session-Id"] = server.sessionId;
  const response = await requestPublicUrl(server.url, {
    protocols: ["https:"],
    allowCustomPort: true,
    maxRedirects: 0,
    method: "POST",
    headers,
    body: JSON.stringify(jsonRpcBody(id, method, params)),
    maxBytes: MAX_RPC_RESPONSE_BYTES,
    timeoutMs: 7000,
    signal: AbortSignal.timeout(7000),
  });
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) server.sessionId = sessionId;
  if (!response.ok) throw new Error(`MCP ${response.status}`);
  const rpc = await readRpcResponse(response);
  if (rpc?.error) throw new Error(safeText(rpc.error.message || "MCP error", 500));
  return rpc?.result || null;
}

async function initializeServer(row) {
  if (row.type !== "remote" || !row.base_url) return null;
  const secret = connectorSecretPayload(row);
  const server = {
    id: row.id,
    name: row.name,
    url: row.base_url,
    headers: buildHeaders(secret),
    sessionId: null,
    configFingerprint: fingerprint({ id: row.id, name: row.name, base_url: row.base_url, secret_payload: row.secret_payload || "" }),
  };
  await mcpRequest(server, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "KAZER", version: "1.0.0" },
  }, 1);
  await mcpRequest(server, "notifications/initialized", {}, 2).catch(() => null);
  const result = await mcpRequest(server, "tools/list", { cursor: undefined }, 3);
  const tools = Array.isArray(result?.tools) ? result.tools.slice(0, MAX_TOOLS_PER_SERVER) : [];
  return {
    ...server,
    tools: tools.map((tool) => ({
      name: safeText(tool.name, 120),
      description: safeText(tool.description || `Ferramenta do MCP ${row.name}`, 1000),
      inputSchema: validateToolSchema(tool.inputSchema),
    })).filter((tool) => tool.name && tool.inputSchema).sort((left, right) => left.name.localeCompare(right.name)), 
  };
}

async function getConnectedMcpCount(userId, requestedIds = []) {
  try {
    const rows = await supabaseRequest("kazer_mcp_connectors", {
      query: { select: "id", user_id: `eq.${userId}`, status: "eq.connected", order: "updated_at.desc", limit: MAX_SERVERS },
    });
    const requested = new Set(Array.isArray(requestedIds) ? requestedIds.map(String) : []);
    const connected = Array.isArray(rows) ? rows : [];
    return requested.size ? connected.filter((row) => requested.has(String(row.id))).length : connected.length;
  } catch (error) {
    console.warn("MCP count unavailable", safeErrorFields(error));
    return 0;
  }
}

async function loadMcpRuntime(userId, requestedIds = []) {
  try {
    const rows = await supabaseRequest("kazer_mcp_connectors", {
      query: { select: "id,name,type,base_url,command,status,secret_payload", user_id: `eq.${userId}`, status: "eq.connected", order: "updated_at.desc", limit: MAX_SERVERS },
    });
    const requested = new Set(Array.isArray(requestedIds) && requestedIds.length ? requestedIds.map(String) : (rows || []).map((row) => String(row.id)));
    const connected = (Array.isArray(rows) ? rows : []).filter((row) => requested.has(String(row.id))).slice(0, MAX_SERVERS);
    const servers = [];
    for (const row of connected) {
      try {
        const server = await initializeServer(row);
        if (server?.tools?.length) servers.push(server);
      } catch (error) {
        console.warn("MCP discovery skipped", { connectorId: row.id, ...safeErrorFields(error) });
      }
    }
    return servers;
  } catch (error) {
    console.warn("MCP runtime unavailable", safeErrorFields(error));
    return [];
  }
}

function flattenTools(servers) {
  const tools = [];
  const byName = new Map();
  for (const server of servers) {
    for (const tool of server.tools || []) {
      if (tools.length >= MAX_TOTAL_TOOLS) break;
      const name = `mcp_${String(server.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}_${String(tool.name).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48)}`.slice(0, 64);
      if (byName.has(name)) continue;
      const exposed = { type: "function", function: { name, description: `[${server.name}] ${tool.description}`, parameters: tool.inputSchema } };
      tools.push(exposed);
      byName.set(name, {
        server,
        tool,
        functionName: name,
        serverFingerprint: server.configFingerprint,
        schemaFingerprint: fingerprint(tool.inputSchema),
      });
    }
  }
  return { tools, byName };
}

async function callMcpTool(entry, argumentsValue) {
  const validation = validateMcpArguments(entry?.tool?.inputSchema, argumentsValue);
  if (!validation.ok) throw new Error(validation.error);
  const result = await mcpRequest(entry.server, "tools/call", { name: entry.tool.name, arguments: validation.args }, Date.now());
  return JSON.stringify(result || {}).slice(0, MAX_TOOL_RESULT_CHARS);
}

module.exports = { MAX_RPC_RESPONSE_BYTES, callMcpTool, flattenTools, getConnectedMcpCount, loadMcpRuntime, mcpRuntimeFingerprint, readRpcResponse };
