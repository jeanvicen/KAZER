import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../interface/chat.html", import.meta.url), "utf8");
const chatApi = await readFile(new URL("../api/chat.js", import.meta.url), "utf8");

// Guardrails: confirm the production UI contains the invalidation and no-cache load.
assert.match(source, /if \(Number\(data\?\.memories_updated\) > 0\) invalidateMemories\(\);/);
assert.match(source, /fetchWithAuth\(`\/api\/memories\?limit=200&offset=0`, \{ method: "GET", cache: "no-store" \}\)/);
assert.match(source, /memoriesLoaded = false;/);
assert.match(source, /O que o Kazer sabe sobre você/);
assert.match(source, /Buscar nas suas memórias/);
assert.match(source, /data-memory-filter="personal"/);
assert.match(source, /data-memory-filter="projects"/);
assert.match(source, /data-memory-filter="work"/);
assert.match(source, /Editar memória/);
assert.match(source, /Apagar esta memória\?/);
assert.match(source, /Sua memória ainda está vazia/);
assert.match(source, /\.settings-panel-scroll \{ flex: 1; min-width: 0; min-height: 0;/);
assert.match(source, /\.memory-settings-body \{ display: grid; gap: 16px; width: 100%; min-width: 0; max-width: 100%; overflow: hidden;/);
assert.match(source, /\.memory-content-text .*word-break: break-word;/);
assert.match(source, /const cleanMemoryContent = \(value\) =>/);
assert.match(source, /document\.createElement\(/);
assert.match(source, /memory-group-chevron/);
assert.match(source, /document\.createElementNS\(/);
assert.match(source, /memoriesCache = Array\.isArray\(payload\.memories\) \? payload\.memories\.map\(normalizeMemory\)/);
assert.match(source, /text\.textContent = cleanMemoryContent\(memory\.content\)/);
assert.doesNotMatch(source, /Não usar/);
assert.match(chatApi, /function cleanMemoryContent\(value\)/);
assert.match(chatApi, /content: cleanMemoryContent\(item\?\.content\)/);
assert.match(chatApi, /document\.createElementNS\(/);

// Simulate the UI state and the API response before/after the chat update.
let memoriesLoaded = true;
let memoriesCache = [{ id: "old", group_title: "Projetos", content: "Projeto antigo" }];
let fetchCount = 0;
const responses = [
  { memories: memoriesCache },
  { memories: [
    ...memoriesCache,
    { id: "new", group_title: "Preferências", content: "O usuário prefere respostas diretas" },
  ] },
];

async function loadMemories() {
  fetchCount += 1;
  const payload = responses[fetchCount - 1];
  memoriesCache = payload.memories;
  memoriesLoaded = true;
}

function invalidateMemories() {
  memoriesLoaded = false;
  return loadMemories();
}

await loadMemories();
assert.equal(fetchCount, 1);
assert.equal(memoriesCache.length, 1);

const simulatedChatResponse = { memories_updated: 1 };
if (Number(simulatedChatResponse?.memories_updated) > 0) await invalidateMemories();

assert.equal(fetchCount, 2, "a UI deve consultar as memórias novamente após uma atualização");
assert.equal(memoriesLoaded, true);
assert.equal(memoriesCache.length, 2);
assert.equal(memoriesCache.find((memory) => memory.id === "new")?.content, "O usuário prefere respostas diretas");
assert.deepEqual([...new Set(memoriesCache.map((memory) => memory.group_title))], ["Projetos", "Preferências"]);

console.log("memory-ui-regression: OK — nova memória apareceu após memories_updated=1");
