import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret-key";
process.env.GITHUB_OAUTH_STATE_SECRET = "test-only-oauth-state";
const require = createRequire(import.meta.url);
const data = require("../api/_kazer-data.js");
const github = require("../api/_github.js");
const runtime = require("../api/_mcp-runtime.js");

const encrypted = data.encryptSecret({ API_KEY: "secret-value" });
assert.notEqual(encrypted, JSON.stringify({ API_KEY: "secret-value" }));
assert.deepEqual(data.safeJson(data.decryptSecret(encrypted), {}), { API_KEY: "secret-value" });

const state = github.signState({ userId: "user-1", nonce: "nonce-1", expiresAt: Date.now() + 60_000 });
assert.equal(github.readState(state).userId, "user-1");
assert.equal(github.readState(`${state}tampered`), null);

const flattened = runtime.flattenTools([{
  id: "connector-1",
  name: "Context7",
  tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object", properties: {} } }],
}]);
assert.equal(flattened.tools.length, 1);
assert.equal(flattened.byName.size, 1);
assert.equal(data.connectorForClient({ id: "1", name: "MCP", type: "remote", base_url: "https://example.com", command: null, description: null, status: "connected", secret_payload: encrypted }).hasSecrets, true);
console.log("mcp-smoke: OK");
