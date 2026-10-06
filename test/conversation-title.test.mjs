import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiSource = await readFile(new URL("../api/chat.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../interface/chat.html", import.meta.url), "utf8");
const apiNormalizerSource = apiSource.match(/function normalizeGeneratedChatTitle\(value\) \{[\s\S]*?(?=\nfunction parseTitleMessages)/)?.[0];
const clientHelpersSource = htmlSource.match(/        const titleCase = \(value\) =>[\s\S]*?(?=        const rememberChat =)/)?.[0];
const historyReaderSource = htmlSource.match(/        const readChatHistory = \(\) =>[\s\S]*?(?=        const saveChatHistory =)/)?.[0];
assert.ok(apiNormalizerSource, "Server title normalizer source could not be located");
assert.ok(clientHelpersSource, "Client title helpers could not be located");
assert.ok(historyReaderSource, "History reader source could not be located");
const normalizeGeneratedChatTitle = new Function("cleanModelContent", `${apiNormalizerSource}\nreturn normalizeGeneratedChatTitle;`)(
  (value) => String(value || ""),
);
const { normalizeChatTitle, createChatTitle, isLowValueChatTitle, migrateCorruptedChatTitles } = new Function("historyStoragePrefix", `${clientHelpersSource}\nreturn { normalizeChatTitle, createChatTitle, isLowValueChatTitle, migrateCorruptedChatTitles };`)("kazer-chat-history:");

const request = "Por favor, pode me ajudar a adicionar suporte a anexos no histórico do KAZER?";

test("removes model prefix and surrounding quotes without losing the topic", () => {
  const output = 'Claro! O título sugerido: “Ajustar histórico no KAZER”';
  assert.equal(normalizeGeneratedChatTitle(output), "Ajustar histórico no KAZER");
  assert.equal(normalizeChatTitle(output), "Ajustar histórico no KAZER");
});

test("rejects trailing ellipses and returns the user-request-derived fallback", () => {
  const output = 'Título: “Apenas jog...';
  assert.equal(normalizeGeneratedChatTitle(output), null);
  const fallback = createChatTitle(request);
  assert.equal(fallback, "Suporte a anexos no histórico");
  assert.equal(normalizeChatTitle(output, fallback), fallback);
  assert.doesNotMatch(fallback, /\.\.\.|…/);
});

test("keeps the 48-character limit on complete word boundaries", () => {
  const output = "Ajustar títulos do histórico sem cortes inesperados e preservar palavras completas";
  const title = normalizeGeneratedChatTitle(output);
  assert.ok(title.length <= 48, `got ${title.length} characters`);
  assert.equal(title, "Ajustar títulos do histórico sem cortes");
  assert.equal(normalizeChatTitle(output).length <= 48, true);
  assert.doesNotMatch(title, /(?:corte|inesperad|preserv|palavr)$/i);
});

test("rejects generic completion words from the model", () => {
  for (const output of ["feito", "ok", "Pronto!", "Nova conversa"]) {
    assert.equal(normalizeGeneratedChatTitle(output), null, output);
    assert.notEqual(normalizeChatTitle(output, "Criar lista de tarefas"), output);
  }
});

test("renders full titles accessibly and lets history titles wrap", () => {
  assert.match(htmlSource, /aria-label="Abrir conversa: '\s*\+ escapeHtml\(item\.title\)/);
  assert.match(htmlSource, /<strong title="' \+ escapeHtml\(item\.title\) \+ '">/);
  assert.match(htmlSource, /overflow-wrap: anywhere; text-overflow: clip; white-space: normal;/);
  assert.doesNotMatch(htmlSource.match(/\.history-item-copy strong \{[^}]*\}/g)?.at(-1) || "", /text-overflow: ellipsis|white-space: nowrap/);
});

test("migrates a persisted Sau... generated title from its original user prompt once", () => {
  const userId = "account-123";
  const historyKey = `kazer-chat-history:${userId}`;
  const markerKey = `${historyKey}:title-migration:v1`;
  const original = [
    {
      id: "chat-corrupt",
      title: "Sau...",
      titleGenerated: true,
      messages: [
        { role: "user", content: request, attachments: [{ name: "notes.txt" }] },
        { role: "assistant", content: "I can help." },
      ],
      createdAt: "2026-10-05T12:00:00.000Z",
      searchText: "keep this exact search metadata",
      excerpt: "original excerpt",
      kind: "chat",
      customField: { preserve: true },
    },
    {
      id: "chat-valid",
      title: "Organizar notas do projeto",
      titleGenerated: true,
      messages: [{ role: "user", content: "Organize minhas notas do projeto" }],
      createdAt: "2026-10-04T12:00:00.000Z",
      searchText: "unchanged search metadata",
      attachments: [{ name: "plan.pdf" }],
    },
  ];
  const values = new Map([[historyKey, JSON.stringify(original)]]);
  const writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
  };

  const first = migrateCorruptedChatTitles(original, userId, storage);
  assert.equal(first.changed, true);
  assert.equal(first.items[0].title, "Suporte a anexos no histórico");
  assert.equal(first.items[0].id, original[0].id);
  assert.deepEqual(first.items[0].messages, original[0].messages);
  assert.equal(first.items[0].createdAt, original[0].createdAt);
  assert.equal(first.items[0].searchText, original[0].searchText);
  assert.deepEqual(first.items[0].customField, original[0].customField);
  assert.deepEqual(first.items[1], original[1], "a valid existing title and its history fields stay untouched");
  assert.deepEqual(JSON.parse(values.get(historyKey)), first.items);
  assert.equal(writes.filter((key) => key === historyKey).length, 1);
  assert.equal(values.get(markerKey), "done");

  const second = migrateCorruptedChatTitles(JSON.parse(values.get(historyKey)), userId, storage);
  assert.equal(second.changed, false);
  assert.equal(writes.filter((key) => key === historyKey).length, 1, "a repeat read does not rewrite migrated history");
});

test("uses a safe fallback when a corrupted title has no saved user prompt", () => {
  const userId = "account-no-prompt";
  const historyKey = `kazer-chat-history:${userId}`;
  const item = { id: "chat-empty", title: "Sau…", titleGenerated: true, messages: [{ role: "assistant", content: "No user prompt" }], createdAt: "2026-10-01T00:00:00.000Z" };
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const result = migrateCorruptedChatTitles([item], userId, storage);
  assert.equal(result.items[0].title, "Nova conversa");
  assert.equal(result.items[0].id, item.id);
  assert.deepEqual(result.items[0].messages, item.messages);
  assert.deepEqual(JSON.parse(values.get(historyKey)), result.items);
});

test("runs the title migration only after the authenticated user ID is available", () => {
  assert.match(historyReaderSource, /if \(currentUser\?\.id\) \{\s*items = migrateCorruptedChatTitles\(items, currentUser\.id\)\.items;/);
  assert.match(clientHelpersSource, /const markerKey = historyKey \+ ":title-migration:v1"/);
  assert.match(clientHelpersSource, /storage\.setItem\(historyKey, JSON\.stringify\(migratedItems\)\)/);
});
