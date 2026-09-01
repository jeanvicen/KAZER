import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-key";
process.env.GITHUB_CLIENT_ID = "test-github-client";
process.env.PUBLIC_APP_ORIGINS = "https://kazer.example";
const require = createRequire(import.meta.url);

function responseOf() {
  return {
    headers: {},
    statusCode: 200,
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; },
    end(value = "") { this.body = value; },
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
  if (url.includes("/rest/v1/kazer_mcp_connectors")) {
    if (init.method === "POST") return new Response(JSON.stringify([{ id: "mcp-1", user_id: "user-1", name: "Context7", type: "remote", base_url: "https://mcp.example/mcp", command: null, description: null, status: "connected", secret_payload: null }]), { status: 201 });
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (url.includes("/rest/v1/kazer_tasks")) {
    return new Response(JSON.stringify([{ id: "task-1", user_id: "user-1", prompt: "Criar uma tela", title: "Criar uma tela", task_type: "chat", repo_url: null, selected_agent: null, selected_model: null, mcp_connector_ids: [], status: "processing", progress: 15, logs: [], result: null, error: null, credit_cost: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null }]), { status: 201 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const request = { method: "GET", headers: { authorization: "Bearer test-bearer-token-123456" }, query: {} };
const mcpHandler = require("../api/mcp.js");
const mcpResponse = responseOf();
await mcpHandler(request, mcpResponse);
assert.equal(mcpResponse.statusCode, 200);
assert.equal(JSON.parse(mcpResponse.body).connectors.length, 0);

const taskHandler = require("../api/tasks.js");
const taskResponse = responseOf();
await taskHandler({ ...request, method: "POST", body: { prompt: "Criar uma tela", taskType: "chat" } }, taskResponse);
assert.equal(taskResponse.statusCode, 201);
assert.equal(JSON.parse(taskResponse.body).task.id, "task-1");

const githubHandler = require("../api/github-connect.js");
const githubResponse = responseOf();
await githubHandler({ ...request, headers: { ...request.headers, host: "kazer.example" } }, githubResponse);
assert.equal(githubResponse.statusCode, 200);
assert.match(JSON.parse(githubResponse.body).url, /github\.com\/login\/oauth\/authorize/);

await import("node:fs/promises").then((fs) => fs.writeFile("/tmp/kazer-api-smoke-restored", "ok"));
globalThis.fetch = originalFetch;
console.log("api-smoke: OK");
