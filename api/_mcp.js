const crypto = require("node:crypto");
const { getBearerToken, supabaseBaseUrl } = require("./_security");

const TABLE = "kazer_mcp_connections";

function encryptionKey() {
  const value = process.env.MCP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("mcp_encryption_not_configured");
  return crypto.createHash("sha256").update(String(value)).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value) {
  const [iv, tag, encrypted] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function config() {
  return { serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

function dbHeaders() {
  const value = config();
  if (!value.serviceRoleKey) throw new Error("supabase_service_role_not_configured");
  return { apikey: value.serviceRoleKey, Authorization: "Bearer " + value.serviceRoleKey, "Content-Type": "application/json", Prefer: "return=representation" };
}

async function dbRequest(path, options = {}) {
  const base = supabaseBaseUrl();
  if (!base) throw new Error("supabase_unavailable");
  const result = await fetch(base + "/rest/v1/" + path, { ...options, headers: { ...dbHeaders(), ...(options.headers || {}) }, signal: AbortSignal.timeout(8000) });
  const data = await result.json().catch(() => null);
  if (!result.ok) throw new Error(data?.message || "mcp_storage_failed");
  return data;
}

function isSafeRemoteUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" || hostname === "0.0.0.0") return false;
    const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseRemotePayload(text, contentType) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  if (String(contentType).includes("text/event-stream")) {
    const event = String(text).split(/\r?\n/).find((line) => line.trim().startsWith("data:"));
    if (event) try { return JSON.parse(event.replace(/^\s*data:\s*/, "")); } catch {}
  }
  return null;
}

async function remoteRequest(connection, body, sessionId) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (connection.access_token) headers.Authorization = "Bearer " + decrypt(connection.access_token);
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const result = await fetch(connection.base_url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(12000) });
  const text = await result.text();
  const payload = parseRemotePayload(text, result.headers.get("content-type"));
  if (!result.ok) {
    const error = new Error(payload?.error?.message || "mcp_remote_request_failed");
    error.status = result.status;
    throw error;
  }
  if (payload?.error) throw new Error(payload.error.message || "mcp_remote_error");
  return { payload, sessionId: result.headers.get("mcp-session-id") || sessionId || null };
}

async function validateRemoteMcp(connection) {
  const initialized = await remoteRequest(connection, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "KAZER", version: "1.0.0" } } });
  const sessionId = initialized.sessionId;
  try { await remoteRequest(connection, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId); } catch {}
  let tools = [];
  try {
    const listed = await remoteRequest(connection, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
    tools = Array.isArray(listed.payload?.result?.tools) ? listed.payload.result.tools : [];
  } catch {}
  return { sessionId, toolsCount: tools.length };
}

async function getConnection(userId, id) {
  const filter = "user_id=eq." + encodeURIComponent(userId) + (id ? "&id=eq." + encodeURIComponent(id) : "") + "&limit=1";
  const rows = await dbRequest(TABLE + "?select=*&" + filter, { method: "GET" });
  return rows?.[0] || null;
}

async function listConnections(userId) {
  return dbRequest(TABLE + "?select=id,name,description,type,base_url,status,tools_count,created_at,updated_at&user_id=eq." + encodeURIComponent(userId) + "&order=created_at.desc", { method: "GET" });
}

async function createConnection(userId, data) {
  const connection = { id: crypto.randomUUID(), user_id: userId, name: data.name, description: data.description || null, type: "remote", base_url: data.baseUrl, access_token: data.token ? encrypt(data.token) : null, status: "disconnected", tools_count: 0, updated_at: new Date().toISOString() };
  const handshake = await validateRemoteMcp(connection);
  connection.status = "connected";
  connection.tools_count = handshake.toolsCount;
  const rows = await dbRequest(TABLE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(connection) });
  return rows?.[0] || connection;
}

async function setConnectionStatus(userId, id, status) {
  const current = await getConnection(userId, id);
  if (!current) throw new Error("mcp_not_found");
  let toolsCount = current.tools_count || 0;
  if (status === "connected") toolsCount = (await validateRemoteMcp(current)).toolsCount;
  const rows = await dbRequest(TABLE + "?id=eq." + encodeURIComponent(id) + "&user_id=eq." + encodeURIComponent(userId), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status, tools_count: toolsCount, updated_at: new Date().toISOString() }) });
  return rows?.[0] || { ...current, status, tools_count: toolsCount };
}

async function deleteConnection(userId, id) {
  return dbRequest(TABLE + "?id=eq." + encodeURIComponent(id) + "&user_id=eq." + encodeURIComponent(userId), { method: "DELETE" });
}

module.exports = { createConnection, decrypt, deleteConnection, getBearerToken, getConnection, isSafeRemoteUrl, listConnections, setConnectionStatus };
