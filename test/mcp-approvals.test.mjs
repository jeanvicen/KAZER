import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://mcp-approval-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role-key-never-use-in-production";
process.env.KAZER_CONNECTOR_ENCRYPTION_KEY = "test-only-encryption-key-for-unit-tests";

const require = createRequire(import.meta.url);
const table = new Map();
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || "GET";
  if (!url.pathname.endsWith("/rest/v1/kazer_mcp_approvals")) throw new Error("unexpected endpoint");
  const body = options.body ? JSON.parse(options.body) : null;
  const query = url.searchParams;
  const id = query.get("id")?.replace(/^eq\./, "");
  const userId = query.get("user_id")?.replace(/^eq\./, "");
  if (method === "DELETE") {
    for (const [key, row] of table) if (Date.parse(row.expires_at) < Date.now()) table.delete(key);
    return response([]);
  }
  if (method === "POST") {
    table.set(body.id, { ...body, created_at: new Date().toISOString(), claimed_at: null, completed_at: null });
    return response([table.get(body.id)], 201);
  }
  if (method === "GET") {
    const row = table.get(id);
    const matches = row && row.user_id === userId && row.status === "pending" && Date.parse(row.expires_at) > Date.now();
    return response(matches ? [row] : []);
  }
  if (method === "PATCH") {
    const row = table.get(id);
    const status = query.get("status")?.replace(/^eq\./, "");
    const matches = row && row.user_id === userId && row.status === status && (status !== "pending" || Date.parse(row.expires_at) > Date.now());
    if (!matches) return response([]);
    const updated = { ...row, ...body };
    table.set(id, updated);
    return response([updated]);
  }
  throw new Error(`unexpected method ${method}`);
};

const approvals = require("../api/_mcp-approvals.js");
const USER = "00000000-0000-4000-8000-000000000001";
const CONTEXT = "a".repeat(64);

test("MCP approval payload is encrypted, user-bound, atomic single-use, and erased after completion", async () => {
  table.clear();
  const continuation = { pendingTool: { args: { text: "private value" } }, deltaMessages: [] };
  const ticket = await approvals.createMcpApproval(USER, CONTEXT, continuation);
  const stored = table.get(ticket.id);
  assert.ok(stored);
  assert.equal(stored.status, "pending");
  assert.ok(stored.payload_encrypted.startsWith("v1."));
  assert.equal(stored.payload_encrypted.includes("private value"), false);

  const wrongUser = await approvals.getPendingMcpApproval("00000000-0000-4000-8000-000000000002", ticket.id);
  assert.equal(wrongUser, null);
  const pending = await approvals.getPendingMcpApproval(USER, ticket.id);
  assert.equal(pending.payload.contextHash, CONTEXT);
  assert.deepEqual(pending.payload.continuation, continuation);

  const claims = await Promise.all([
    approvals.claimMcpApproval(USER, ticket.id),
    approvals.claimMcpApproval(USER, ticket.id),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  await approvals.finishMcpApproval(USER, ticket.id, "approved");
  assert.equal(table.get(ticket.id).status, "approved");
  assert.equal(table.get(ticket.id).payload_encrypted, null);
  assert.equal(await approvals.getPendingMcpApproval(USER, ticket.id), null);
});

test("approval payload parser fails closed on altered ciphertext", () => {
  assert.equal(approvals.parseApprovalPayload("not-a-valid-ciphertext"), null);
});
