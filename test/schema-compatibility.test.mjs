import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskApi = readFileSync(new URL("../api/_tasks-handler.js", import.meta.url), "utf8");
const taskMigration = readFileSync(new URL("../database/supabase/018_remove_consumption_controls.sql", import.meta.url), "utf8");
const driveApi = readFileSync(new URL("../api/google-drive.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../download/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../download/manifest.webmanifest", import.meta.url), "utf8"));

test("task API matches the post-cleanup Supabase schema", () => {
  assert.match(taskMigration, /drop column if exists credit_cost/i);
  assert.match(taskMigration, /check \(task_type in \('chat', 'coding', 'research'\)\)/i);
  assert.doesNotMatch(taskApi, /credit_cost/);
  assert.match(taskApi, /const taskType = \["chat", "coding", "research"\]/);
});

test("Google Drive reserves current monthly usage and retains legacy compatibility", () => {
  assert.match(driveApi, /callUsageRpc\(request, "consume_kazer_usage", \{ p_message_count: 1, p_attachment_count: 0 \}\)/);
  assert.match(driveApi, /callUsageRpc\(request, "consume_chat_usage", \{ p_credit_amount: 10, p_attachment_count: 0 \}\)/);
  assert.match(driveApi, /initialError\.status === 404/);
  assert.match(driveApi, /error\?\.code === "usage_limit_reached"/);
});

test("service worker matches query-versioned manifest icons by pathname and caches each icon", () => {
  const start = serviceWorker.indexOf("const APP_SHELL = ");
  const end = serviceWorker.indexOf("\n];", start);
  assert.ok(start >= 0 && end > start, "app-shell list must exist");
  const shell = JSON.parse(serviceWorker.slice(start + "const APP_SHELL = ".length, end + 2));
  const iconPaths = manifest.icons.map((icon) => new URL(icon.src, "https://kazer.example").pathname);
  assert.ok(iconPaths.every((path) => shell.includes(path)), "all manifest icons must be present in the offline shell");
  assert.doesNotMatch(JSON.stringify(shell), /\?v=/, "shell cache keys should be path-only");
  assert.match(serviceWorker, /APP_SHELL\.includes\(url\.pathname\)/);
});
