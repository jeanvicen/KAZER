import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectConversationMessages } = require("../api/_kazer-context.js");
const chatSource = await readFile(new URL("../api/chat.js", import.meta.url), "utf8");
const cleanUserContentSource = chatSource.match(/function cleanUserContent\([\s\S]*?(?=\nfunction normalizeRepositoryContext)/)?.[0];
const historyParserSource = chatSource.match(/function parseMessages\([\s\S]*?(?=\nfunction parseDataUrl)/)?.[0];
assert.ok(cleanUserContentSource && historyParserSource, "Conversation parser source could not be located");
const { parseMessages, parseTitleMessages, isLatestPromptTooLarge } = new Function(
  "MAX_RECEIVED_MESSAGES",
  "MAX_MESSAGES",
  "MAX_USER_MESSAGE_CHARS",
  "MAX_ASSISTANT_MESSAGE_CHARS",
  `${cleanUserContentSource}\n${historyParserSource}\nreturn { parseMessages, parseTitleMessages, isLatestPromptTooLarge };`,
)(72, 48, 8000, 64000);

const message = (role, content) => ({ role, content });
const modelHistory = (messages) => {
  const selected = selectConversationMessages(messages);
  return [...selected.slice(0, -1), messages.at(-1)];
};

test("accepts a supported 16k assistant response on the next user turn", () => {
  const parsed = parseMessages([
    message("user", "Explique em detalhes."),
    message("assistant", "a".repeat(16000)),
    message("user", "Pode resumir a resposta anterior?"),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.at(-1).role, "user");
  assert.equal(parsed[1].content.length, 16000);
  assert.equal(modelHistory(parsed).at(-1).content, "Pode resumir a resposta anterior?");
});

test("accepts a coding answer at the supported 64k cap and compacts it out of model context", () => {
  const parsed = parseMessages([
    message("user", "Escreva um arquivo de código completo."),
    message("assistant", "c".repeat(64000)),
    message("user", "Agora explique a função principal."),
  ]);
  assert.ok(parsed);
  assert.equal(parsed[1].content.length, 64000);
  const selected = modelHistory(parsed);
  assert.equal(selected.at(-1).role, "user");
  assert.equal(selected.at(-1).content, "Agora explique a função principal.");
  assert.ok(selected.reduce((total, item) => total + item.content.length, 0) <= 30000);
});

test("accepts aggregate historical text above 32k while keeping selected context bounded", () => {
  const history = [message("user", "Assunto inicial")];
  for (let index = 0; index < 5; index += 1) {
    history.push(message("assistant", "r".repeat(8000)));
    history.push(message("user", `Pergunta intermediária ${index + 1}`));
  }
  history.push(message("user", "Minha pergunta mais recente"));
  assert.ok(history.reduce((total, item) => total + item.content.length, 0) > 32000);

  const parsed = parseMessages(history);
  assert.ok(parsed, "Long valid history should not be rejected as invalid");
  assert.equal(parsed.at(-1).role, "user");
  assert.equal(parsed.at(-1).content, "Minha pergunta mais recente");
  const selected = modelHistory(parsed);
  assert.equal(selected.at(-1).content, "Minha pergunta mais recente");
  assert.ok(selected.reduce((total, item) => total + item.content.length, 0) <= 30000);
});

test("preserves the latest user turn and final user role after truncating received history", () => {
  const history = Array.from({ length: 52 }, (_, index) => message(index % 2 ? "assistant" : "user", `Turn ${index}`));
  history.push(message("user", "Keep this exact latest prompt"));
  const parsed = parseMessages(history);
  assert.ok(parsed);
  assert.equal(parsed.length, 48);
  assert.equal(parsed.at(-1).role, "user");
  assert.equal(parsed.at(-1).content, "Keep this exact latest prompt");
  assert.equal(modelHistory(parsed).at(-1).content, "Keep this exact latest prompt");
});

test("rejects malformed messages and overlong current prompts without losing the reason", () => {
  assert.equal(parseMessages([message("system", "not allowed"), message("user", "valid")]), null);
  assert.equal(parseMessages([message("user", { text: "not a string" })]), null);
  assert.equal(parseMessages([message("user", "x".repeat(8001))]), null);
  const oversizedPrompt = [message("user", "x".repeat(8001))];
  assert.equal(isLatestPromptTooLarge(oversizedPrompt), true);
  assert.match(chatSource, /Sua mensagem excede o limite de \$\{MAX_USER_MESSAGE_CHARS\.toLocaleString\("pt-BR"\)\} caracteres\./);
});

test("title validation permits supported assistant output and bounds received message count", () => {
  assert.ok(parseTitleMessages([message("user", "Faça um programa"), message("assistant", "c".repeat(64000))]));
  const tooMany = Array.from({ length: 73 }, (_, index) => message(index % 2 ? "assistant" : "user", `message ${index}`));
  assert.equal(parseTitleMessages(tooMany), null);
});
