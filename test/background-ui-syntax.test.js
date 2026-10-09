const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("inline chat scripts parse after background-task integration", () => {
  const html = fs.readFileSync(path.join(root, "interface/chat.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  assert.ok(scripts.length > 0, "expected inline scripts in the chat page");
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new vm.Script(match[2], { filename: `interface/chat.html:inline-script-${index + 1}` }));
  });
});

test("background task UI preserves connector foreground exception and task-id notification routing", () => {
  const html = fs.readFileSync(path.join(root, "interface/chat.html"), "utf8");
  assert.match(html, /needsForegroundConnector\s*=\s*!useWebResearch\s*&&\s*mcpConnectorIds\.length\s*>\s*0/);
  assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\("taskId"\)/);
  assert.match(html, /backgroundMessageId:\s*messageId[\s\S]{0,100}backgroundIdempotencyKey:\s*idempotencyKey/);
});

test("push subscription lookups and updates are scoped to the authenticated user", () => {
  const source = fs.readFileSync(path.join(root, "api/push-subscriptions.js"), "utf8");
  assert.match(source, /endpoint:\s*`eq\.\$\{token\}`,[\s\S]{0,60}user_id:\s*`eq\.\$\{user\.id\}`/);
  assert.match(source, /id:\s*`eq\.\$\{row\.id\}`,[\s\S]{0,60}user_id:\s*`eq\.\$\{user\.id\}`/);
});
