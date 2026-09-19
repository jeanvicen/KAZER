import assert from "node:assert/strict";
import { createRequire } from "node:module";

const previous = {
  nodeEnv: process.env.NODE_ENV,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnon: process.env.SUPABASE_ANON_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

process.env.NODE_ENV = "production";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";

const require = createRequire(import.meta.url);
const security = require("../api/_security.js");
const data = require("../api/_kazer-data.js");

assert.equal(security.supabaseBaseUrl(), null);
assert.equal(security.publicSupabaseAnonKey(), null);
assert.throws(() => data.getSupabaseUrl(), /supabase_unavailable/);
assert.throws(() => data.encryptSecret("secret"), /connector_encryption_key_missing_or_weak/);

process.env.KAZER_CONNECTOR_ENCRYPTION_KEY = "x".repeat(32);
const encrypted = data.encryptSecret("secret");
assert.equal(data.decryptSecret(encrypted), "secret");

delete process.env.KAZER_CONNECTOR_ENCRYPTION_KEY;
if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
if (previous.supabaseUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.supabaseUrl;
if (previous.supabaseAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.supabaseAnon;
if (previous.serviceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceKey;

console.log("production-config-smoke: OK");
