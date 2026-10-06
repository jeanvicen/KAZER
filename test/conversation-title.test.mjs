import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiSource = await readFile(new URL("../api/chat.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../interface/chat.html", import.meta.url), "utf8");
const apiNormalizerSource = apiSource.match(/function normalizeGeneratedChatTitle\(value\) \{[\s\S]*?(?=\nfunction parseTitleMessages)/)?.[0];
const clientHelpersSource = htmlSource.match(/        const titleCase = \(value\) =>[\s\S]*?(?=        const rememberChat =)/)?.[0];
assert.ok(apiNormalizerSource, "Server title normalizer source could not be located");
assert.ok(clientHelpersSource, "Client title helpers could not be located");
const normalizeGeneratedChatTitle = new Function("cleanModelContent", `${apiNormalizerSource}\nreturn normalizeGeneratedChatTitle;`)(
  (value) => String(value || ""),
);
const { normalizeChatTitle, createChatTitle } = new Function(`${clientHelpersSource}\nreturn { normalizeChatTitle, createChatTitle };`)();

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
