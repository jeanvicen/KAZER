const crypto = require("node:crypto");
const {
  authenticateUser,
  getBearerToken,
  isSameOrigin,
  hasSafeFetchMetadata,
  sendJson,
} = require("./_security");

const PUBLIC_SUPABASE_URL = "https://mqjunopzycdezzjmlhip.supabase.co";
const MAX_PAGE_SIZE = 100;

function getSupabaseUrl() {
  const value = process.env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_supabase_url");
    return url.origin;
  } catch {
    throw new Error("supabase_unavailable");
  }
}

function getServiceKey() {
  const value = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "").trim();
  if (!value) throw new Error("supabase_service_key_missing");
  return value;
}

function getEncryptionKey() {
  const configured = String(process.env.KAZER_CONNECTOR_ENCRYPTION_KEY || "").trim();
  const source = configured || getServiceKey();
  return crypto.createHash("sha256").update(source, "utf8").digest();
}

function encryptSecret(value) {
  const plaintext = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value) {
  if (!value || typeof value !== "string") return null;
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) throw new Error("secret_invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

function safeJson(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function supabaseRequest(path, { method = "GET", body, query } = {}) {
  const baseUrl = getSupabaseUrl();
  const url = new URL(`${baseUrl}/rest/v1/${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
  }
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: getServiceKey(),
      Authorization: `Bearer ${getServiceKey()}`,
      ...(method !== "GET" ? { Prefer: "return=representation" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || data?.error || "supabase_request_failed");
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function requireUser(request) {
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return null;
  return authenticateUser(request);
}

function getUserBearer(request) {
  return getBearerToken(request);
}

function badRequest(response, message = "Requisição inválida.") {
  return sendJson(response, 400, { error: message });
}

function unauthorized(response) {
  return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
}

function connectorForClient(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    type: row.type,
    baseUrl: row.base_url || null,
    command: row.command || null,
    status: row.status,
    hasSecrets: Boolean(row.secret_payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function connectorSecretPayload(row) {
  if (!row?.secret_payload) return {};
  const decoded = safeJson(decryptSecret(row.secret_payload), {});
  return decoded && typeof decoded === "object" ? decoded : {};
}

function taskForClient(row) {
  return {
    id: row.id,
    title: row.title || String(row.prompt || "").slice(0, 72),
    prompt: row.prompt,
    taskType: row.task_type,
    repoUrl: row.repo_url,
    selectedAgent: row.selected_agent,
    selectedModel: row.selected_model,
    mcpConnectorIds: Array.isArray(row.mcp_connector_ids) ? row.mcp_connector_ids : safeJson(row.mcp_connector_ids, []),
    status: row.status,
    progress: Number(row.progress || 0),
    logs: Array.isArray(row.logs) ? row.logs : safeJson(row.logs, []),
    result: row.result || null,
    error: row.error || null,
    creditCost: Number(row.credit_cost || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

module.exports = {
  MAX_PAGE_SIZE,
  badRequest,
  connectorForClient,
  connectorSecretPayload,
  decryptSecret,
  encryptSecret,
  getServiceKey,
  getSupabaseUrl,
  getUserBearer,
  requireUser,
  safeJson,
  supabaseRequest,
  taskForClient,
  unauthorized,
};
