import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../interface/kazer-premium.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../api/chat.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../interface/chat.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../interface/kazer-premium.css", import.meta.url), "utf8");
const runFunctionBlock = (source, start, end, tail) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing source block: ${start}`);
  assert.notEqual(to, -1, `missing source block end: ${end}`);
  return new Function(`${source.slice(from, to)}\n${tail}`)();
};

const serverValidators = runFunctionBlock(server, "const HOME_SUGGESTION_CATEGORIES", "async function callGroq(", "return { normalizeHomeSuggestionText, parseHomeSuggestionResponse };");
const validBatch = [
  { texto: "Planejar uma manhã tranquila", categoria: "plan" },
  { texto: "Escrever com mais clareza", categoria: "write" },
  { texto: "Entender um conceito novo", categoria: "learn" },
  { texto: "Criar uma ideia diferente", categoria: "creativity" },
];

test("server enforces four unique, short suggestions and safe categories", () => {
  const { parseHomeSuggestionResponse } = serverValidators;
  assert.equal(parseHomeSuggestionResponse(JSON.stringify(validBatch), [] )?.length, 4);
  assert.equal(parseHomeSuggestionResponse(`\n\`\`\`json\n${JSON.stringify(validBatch)}\n\`\`\``, [])?.length, 4);
  assert.equal(parseHomeSuggestionResponse(JSON.stringify(validBatch.slice(0, 3)), []), null);
  assert.equal(parseHomeSuggestionResponse(JSON.stringify([...validBatch, validBatch[0]]), []), null);
  assert.equal(parseHomeSuggestionResponse(JSON.stringify(validBatch), [validBatch[0].texto]), null);
  assert.equal(parseHomeSuggestionResponse(JSON.stringify([{ ...validBatch[0], categoria: "<script>" }, ...validBatch.slice(1)]), []), null);
  assert.equal(parseHomeSuggestionResponse(JSON.stringify([{ texto: "Um dois tres quatro cinco seis", categoria: "plan" }, ...validBatch.slice(1)]), []), null);
});

test("client validates labels and keeps a 20-item no-repeat fallback cycle", () => {
  const interval = Number(client.match(/const SUGGESTION_INTERVAL_MS = (\d+);/)?.[1]);
  assert.equal(interval, 120000);
  const fallbackStart = client.indexOf("const FALLBACK_BANK = [");
  const fallbackEnd = client.indexOf("\n  ];", fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd >= 0, "local fallback bank must exist");
  const bankLiteral = client.slice(fallbackStart + "const FALLBACK_BANK = ".length, fallbackEnd + "\n  ]".length);
  const bank = new Function(`return ${bankLiteral}`)();
  assert.ok(bank.length >= 30);
  const categoryNames = [...client.matchAll(/^    (\w+): '<(?:rect|path|circle)/gm)].map((match) => match[1]);
  const clientBlock = runFunctionBlock(client, "const normalize =", "let recentItems =", "return { validItem, normalize };");
  const { validItem, normalize } = new Function(
    "CATEGORY_ICONS",
    `const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_ICONS)); ${clientBlock}`
  )(Object.fromEntries(categoryNames.map((name) => [name, ""]))) || {};
  assert.equal(validItem({ texto: "Planejar uma manhã tranquila", categoria: "plan" }).texto, "Planejar uma manhã tranquila");
  assert.equal(validItem({ texto: "Frase longa com seis palavras aqui", categoria: "plan" }), null);
  assert.equal(validItem({ texto: "Prompt malicioso", categoria: "<script>" }), null);

  const fallbackStart = client.indexOf("const fallbackBatch = () => {");
  const fallbackEnd = client.indexOf("const timeBand =", fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, "fallback batch source must exist");
  const fallbackSource = client.slice(fallbackStart, fallbackEnd);
  const state = new Function("FALLBACK_BANK", "normalize", `let recentItems = []; let fallbackCursor = 0; ${fallbackSource} return { fallbackBatch, remember(items) { recentItems = [...recentItems, ...items].slice(-20); } };`)(bank, normalize);
  for (let batchIndex = 0; batchIndex < 12; batchIndex += 1) {
    const previous = new Set(state.previous || []);
    const batch = state.fallbackBatch();
    assert.equal(batch.length, 4);
    assert.equal(new Set(batch.map((item) => normalize(item.texto))).size, 4);
    assert.ok(batch.every((item) => !previous.has(normalize(item.texto))));
    state.remember(batch);
    state.previous = [...new Set([...(state.previous || []), ...batch.map((item) => item.texto)])].slice(-20);
  }
});

test("authenticated bridge is narrow, inline scripts parse, and suggestion CSS is balanced", () => {
  assert.match(html, /window\.kazerFetchHomeSuggestions\s*=\s*\(payload = \{\}, signal\) => fetchWithAuth\("\/api\/chat"/);
  assert.match(html, /purpose: "suggestions", localTimeBand: payload\?\.localTimeBand, recentSuggestions: payload\?\.recentSuggestions/);
  assert.match(html, /id="messageInput"/);
  assert.match(html, /class="composer-dock"/);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
    assert.doesNotThrow(() => new vm.Script(match[2]), "inline script should parse");
  }
  let depth = 0;
  let quote = "";
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (comment) { if (char === "*" && css[index + 1] === "/") { comment = false; index += 1; } continue; }
    if (quote) { if (char === "\\") index += 1; else if (char === quote) quote = ""; continue; }
    if (char === "/" && css[index + 1] === "*") { comment = true; index += 1; continue; }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") { depth -= 1; assert.ok(depth >= 0, "CSS has no unmatched closing brace"); }
  }
  assert.equal(depth, 0);
  assert.match(css, /\.kz-suggestion:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
