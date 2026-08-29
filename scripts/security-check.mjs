import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const failures = [];
const read = (path) => readFile(join(root, path), "utf8");
const assert = (condition, message) => { if (!condition) failures.push(message); };

const [chat, login, coder, chatApi, webSearchApi, retentionApi, securityApi, vercel, sql001, sql003, sql004, envExample] = await Promise.all([
  read("interface/chat.html"),
  read("interface/login.html"),
  read("kaze-coder/index.html"),
  read("api/chat.js"),
  read("api/web-search.js"),
  read("api/retention.js"),
  read("api/_security.js"),
  read("vercel.json"),
  read("database/supabase/001_auth_accounts.sql"),
  read("database/supabase/003_retention_notifications.sql"),
  read("database/supabase/004_security_hardening.sql"),
  read(".env.example"),
]);

for (const [name, value] of [["chat.html", chat], ["login.html", login], ["kaze-coder/index.html", coder]]) {
  assert(!/\b(?:GROQ_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|CRON_SECRET)\b/.test(value), `${name}: contém nome de segredo privado no cliente`);
  assert(!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value), `${name}: contém bloco de chave privada`);
  assert(!/\b(?:sk|gsk)_[A-Za-z0-9_-]{16,}\b/i.test(value), `${name}: contém chave de provedor`);
  assert(!/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/i.test(value), `${name}: contém token GitHub`);
}

assert(chatApi.includes("authenticateUser") && webSearchApi.includes("authenticateUser"), "APIs de chat/pesquisa sem autenticação server-side");
assert(chatApi.includes("rateLimit") && webSearchApi.includes("rateLimit"), "APIs de chat/pesquisa sem rate limiting");
assert(chatApi.includes("MAX_TOTAL_ATTACHMENT_BYTES") && chatApi.includes("isAllowedAttachment"), "Chat sem limite/tipagem server-side de anexos");
assert(chatApi.includes("redactSensitiveText") && chatApi.includes("MAX_OUTPUT_CHARS"), "Chat sem limpeza/limite de resposta");
assert(webSearchApi.includes("readTextWithLimit") && webSearchApi.includes("AbortSignal.timeout"), "Pesquisa sem timeout/limite de upstream");
assert(retentionApi.includes("timingSafeEqualText") && retentionApi.includes("RETENTION_DELETE_ENABLED"), "Retenção sem comparação segura/flag de exclusão");
assert(securityApi.includes("hasSafeFetchMetadata") && securityApi.includes("requestExceedsLimit") && securityApi.includes("Cache-Control"), "Módulo de segurança incompleto");

const headers = JSON.parse(vercel).headers.flatMap((entry) => entry.headers.map((header) => header.key.toLowerCase()));
for (const expected of ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "permissions-policy", "cross-origin-opener-policy"]) {
  assert(headers.includes(expected), `vercel.json: cabeçalho ausente: ${expected}`);
}
assert(vercel.includes("upgrade-insecure-requests"), "vercel.json: HTTPS não é forçado pela CSP");
assert(vercel.includes('"X-Frame-Options", "value": "DENY"'), "vercel.json: framing não está negado");

assert(sql001.includes("enable row level security") && sql001.includes("profiles_select_own") && sql001.includes("user_settings_select_own"), "Migração principal sem RLS/policies esperadas");
assert(sql003.includes("enable row level security") && sql003.includes("account_notifications_select_own"), "Notificações sem RLS/policy esperada");
assert(sql004.includes("force row level security") && sql004.includes("revoke insert, delete"), "Migração de endurecimento incompleta");
for (const required of ["GROQ_API_KEY=", "GEMINI_API_KEY=", "SUPABASE_SERVICE_ROLE_KEY=", "CRON_SECRET=", "RETENTION_DELETE_ENABLED=false"]) {
  assert(envExample.includes(required), `.env.example: variável ausente: ${required}`);
}

const syntaxTargets = ["api/_security.js", "api/chat.js", "api/web-search.js", "api/retention.js", "download/sw.js"];
for (const target of syntaxTargets) {
  try {
    execFileSync(process.execPath, ["--check", join(root, target)], { stdio: "pipe" });
  } catch (error) {
    failures.push(`${target}: falha de sintaxe (${error.stderr?.toString().trim() || "erro desconhecido"})`);
  }
}

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const secretPattern = /(?:sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----)/;
for (const path of tracked) {
  if (/\.(?:md|png|jpg|jpeg|svg|jar|lock)$/i.test(path) || path === ".env.example" || path === "scripts/security-check.mjs") continue;
  const text = await read(path);
  assert(!secretPattern.test(text), `${path}: padrão de segredo privado detectado`);
}

if (failures.length) {
  console.error("Falhas de segurança:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("security-check: OK — políticas, limites, headers, autenticação e padrões de segredo verificados.");
