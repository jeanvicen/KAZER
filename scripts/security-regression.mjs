import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { authenticateUser } = require("../api/_security.js");

const originalEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, SUPABASE_KEY: process.env.SUPABASE_KEY };
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const request = { headers: { authorization: "Bearer test-user-session-token-123456" } };
const timeoutId = { testTimeout: true };
let timeoutCallback;
let clearedTimeouts = 0;

try {
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  delete process.env.SUPABASE_KEY;
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 5000);
    timeoutCallback = callback;
    return timeoutId;
  };
  globalThis.clearTimeout = (id) => {
    if (id === timeoutId) clearedTimeouts += 1;
  };

  globalThis.fetch = async () => { throw new Error("simulated upstream connection failure"); };
  assert.equal(await authenticateUser(request), null);
  assert.equal(clearedTimeouts, 1, "fetch failures must release their authentication timeout");

  clearedTimeouts = 0;
  let timeoutWasClearedBeforeBody = null;
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      timeoutWasClearedBeforeBody = clearedTimeouts > 0;
      signal.addEventListener("abort", () => reject(new Error("simulated body timeout")), { once: true });
      queueMicrotask(timeoutCallback);
    }),
  });
  assert.equal(await authenticateUser(request), null);
  assert.equal(timeoutWasClearedBeforeBody, false, "body parsing must remain within the authentication timeout");
  assert.equal(clearedTimeouts, 1, "body timeouts must release their authentication timer");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("security-regression: OK — authentication timers are cleared on network and body failures.");
