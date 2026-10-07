const crypto = require("node:crypto");
const { decryptSecret, encryptSecret, supabaseRequest } = require("./_kazer-data");

const APPROVAL_TTL_MS = 5 * 60_000;
const MAX_ENCRYPTED_PAYLOAD_CHARS = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseApprovalPayload(value) {
  if (typeof value !== "string" || value.length > MAX_ENCRYPTED_PAYLOAD_CHARS) return null;
  try {
    const parsed = JSON.parse(decryptSecret(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function createMcpApproval(userId, contextHash, continuation) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) throw new Error("mcp_approval_user_invalid");
  if (typeof contextHash !== "string" || !/^[a-f0-9]{64}$/.test(contextHash)) throw new Error("mcp_approval_context_invalid");
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + APPROVAL_TTL_MS).toISOString();
  const payload = encryptSecret({ version: 1, id, userId, contextHash, expiresAt, continuation });
  if (payload.length > MAX_ENCRYPTED_PAYLOAD_CHARS) throw new Error("mcp_approval_payload_too_large");
  await supabaseRequest("kazer_mcp_approvals", {
    method: "DELETE",
    query: { expires_at: `lt.${new Date(now).toISOString()}` },
  }).catch(() => null);
  await supabaseRequest("kazer_mcp_approvals", {
    method: "POST",
    body: { id, user_id: userId, status: "pending", payload_encrypted: payload, expires_at: expiresAt },
  });
  return { id, expiresAt };
}

async function getPendingMcpApproval(userId, id) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  const rows = await supabaseRequest("kazer_mcp_approvals", {
    query: {
      select: "id,user_id,status,payload_encrypted,expires_at",
      id: `eq.${id}`,
      user_id: `eq.${userId}`,
      status: "eq.pending",
      expires_at: `gt.${new Date().toISOString()}`,
      limit: 1,
    },
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const payload = parseApprovalPayload(row.payload_encrypted);
  if (!payload || payload.version !== 1 || payload.id !== row.id || payload.userId !== userId || Date.parse(payload.expiresAt) <= Date.now()) return null;
  return { row, payload };
}

async function claimMcpApproval(userId, id) {
  const now = new Date().toISOString();
  const rows = await supabaseRequest("kazer_mcp_approvals", {
    method: "PATCH",
    query: {
      id: `eq.${id}`,
      user_id: `eq.${userId}`,
      status: "eq.pending",
      expires_at: `gt.${now}`,
    },
    body: { status: "processing", claimed_at: now },
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const payload = parseApprovalPayload(row.payload_encrypted);
  if (!payload || payload.version !== 1 || payload.id !== row.id || payload.userId !== userId || Date.parse(payload.expiresAt) <= Date.now()) return null;
  return { row, payload };
}

async function finishMcpApproval(userId, id, status) {
  if (!new Set(["approved", "denied", "error"]).has(status)) throw new Error("mcp_approval_status_invalid");
  await supabaseRequest("kazer_mcp_approvals", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, status: "eq.processing" },
    body: { status, payload_encrypted: null, completed_at: new Date().toISOString() },
  });
}

module.exports = {
  APPROVAL_TTL_MS,
  MAX_ENCRYPTED_PAYLOAD_CHARS,
  UUID_PATTERN,
  claimMcpApproval,
  createMcpApproval,
  finishMcpApproval,
  getPendingMcpApproval,
  parseApprovalPayload,
};
