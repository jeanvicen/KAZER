import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.GITHUB_CLIENT_ID = "client-id";
process.env.GITHUB_CLIENT_SECRET = "client-secret";
process.env.PUBLIC_APP_ORIGINS = "https://kazer.vercel.app";
process.env.GITHUB_OAUTH_STATE_SECRET = "state-secret";

const require = createRequire(import.meta.url);
const { signState } = require("../api/_github.js");
const handler = require("../api/_github-callback-handler.js");

function responseOf() {
  return {
    headers: {}, statusCode: 200, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === "https://github.com/login/oauth/access_token") return new Response(JSON.stringify({ access_token: "token", scope: "repo" }), { status: 200 });
  if (url === "https://api.github.com/user") return new Response(JSON.stringify({ id: 7, login: "mobile-user", name: "Mobile User", avatar_url: "https://avatars.example/user.png" }), { status: 200 });
  if (url === "https://api.github.com/user/emails") return new Response(JSON.stringify([{ email: "mobile@example.com", primary: true }]), { status: 200 });
  if (url.includes("/rest/v1/kazer_github_connections")) return new Response(JSON.stringify([]), { status: 200 });
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

globalThis.fetch = originalFetch;
console.log("github-oauth-smoke: OK");
