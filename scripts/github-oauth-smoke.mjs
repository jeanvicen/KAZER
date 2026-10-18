import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.GITHUB_CLIENT_ID = "client-id";
process.env.GITHUB_CLIENT_SECRET = "client-secret";
process.env.PUBLIC_APP_ORIGINS = "https://kazer.vercel.app";
process.env.GITHUB_OAUTH_STATE_SECRET = "smoke-state-secret-at-least-thirty-two-bytes-long";

const require = createRequire(import.meta.url);
const { readState, signState } = require("../api/_github.js");
const handler = require("../api/_github-callback-handler.js");
const authorizeHandler = require("../api/_github-authorize-handler.js");
const workspaceSource = await fs.readFile(new URL("../interface/kazer-workspace.js", import.meta.url), "utf8");
const connectSource = await fs.readFile(new URL("../server/integrations/_github-connect-handler.js", import.meta.url), "utf8");
const authorizeSource = await fs.readFile(new URL("../server/integrations/_github-authorize-handler.js", import.meta.url), "utf8");
const callbackSource = await fs.readFile(new URL("../server/integrations/_github-callback-handler.js", import.meta.url), "utf8");
assert.match(workspaceSource, /api\("\/api\/github-connect"\)/, "frontend deve iniciar OAuth pelo endpoint autenticado");
assert.doesNotMatch(workspaceSource, /github-authorize\?access_token=/, "token Supabase não pode aparecer na URL OAuth");
assert.match(connectSource, /scope: "repo read:user"/);
assert.match(authorizeSource, /scope: "repo read:user"/);
assert.doesNotMatch(`${connectSource}\n${authorizeSource}\n${callbackSource}`, /user:email|\/user\/emails/, "OAuth não deve pedir nem consultar email privado sem uso");

const savedStateSecret = process.env.GITHUB_OAUTH_STATE_SECRET;
const savedServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stateProbe = { userId: "test-user", nonce: "test-nonce", expiresAt: Date.now() + 60_000 };
const validStateProbe = signState(stateProbe);
delete process.env.GITHUB_OAUTH_STATE_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY = "smoke-service-role-secret-long-enough-for-oauth-state-key";
assert.doesNotThrow(() => signState(stateProbe), "service-role key remains a secure backward-compatible fallback");
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.throws(() => signState(stateProbe), /github_oauth_state_secret_not_configured/, "OAuth state signing must fail closed without a strong configured secret");
assert.equal(readState(validStateProbe), null, "callback rejects old state if its signing key is unavailable");
process.env.GITHUB_OAUTH_STATE_SECRET = savedStateSecret;
if (savedServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = savedServiceKey;

function mockFetchResponse(value, status = 200) {
  // These tests mock fetch; emulate only the response methods used by the handlers.
  const body = JSON.stringify(value);
  return { status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body), text: async () => body };
}

function responseOf() {
  return {
    headers: {}, statusCode: 200, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    end(value = "") { this.body = value; },
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === "https://github.com/login/oauth/access_token") return mockFetchResponse({ access_token: "token", scope: "repo" });
  if (url === "https://api.github.com/user") return mockFetchResponse({ id: 7, login: "mobile-user", name: "Mobile User", avatar_url: "https://avatars.example/user.png" });
  if (url.includes("/rest/v1/kazer_github_connections")) return mockFetchResponse([]);
  throw new Error(`unexpected fetch: ${url}`);
};

const state = signState({ userId: "user-1", nonce: crypto.randomBytes(8).toString("hex"), expiresAt: Date.now() + 60_000 });
const mobileResponse = responseOf();
await handler({ method: "GET", headers: { host: "kazer.vercel.app" }, query: { code: "github-code", state } }, mobileResponse);
assert.equal(mobileResponse.statusCode, 302);
assert.equal(mobileResponse.headers.Location, "https://kazer.vercel.app/chat?github=connected");

const mismatchedCookieResponse = responseOf();
await handler({ method: "GET", headers: { host: "kazer.vercel.app", cookie: "kazer_github_oauth=other-state" }, query: { code: "github-code", state } }, mismatchedCookieResponse);
assert.equal(mismatchedCookieResponse.statusCode, 302);
assert.match(mismatchedCookieResponse.headers.Location, /github=error/);

const queryTokenResponse = responseOf();
await authorizeHandler({ method: "GET", headers: { host: "kazer.vercel.app" }, query: { access_token: "session-token" } }, queryTokenResponse);
assert.equal(queryTokenResponse.statusCode, 405);

globalThis.fetch = originalFetch;
console.log("github-oauth-smoke: OK");
