import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectConversationMessages } = require("../api/_kazer-context.js");

const turn = (role, content) => ({ role, content });

test("preserva o assunto inicial junto da pergunta de acompanhamento", () => {
  const messages = [
    turn("user", "Estamos falando sobre o projeto KAZER e o problema do histórico."),
    turn("assistant", "Entendi o problema do histórico."),
    ...Array.from({ length: 20 }, (_, index) => [
      turn("user", `Atualização intermediária ${index + 1}`),
      turn("assistant", `Resposta intermediária ${index + 1}`),
    ]).flat(),
    turn("user", "E sobre o que estávamos falando mesmo?"),
  ];

  const selected = selectConversationMessages(messages);
  assert.equal(selected[0].content, messages[0].content);
  assert.equal(selected.at(-1).content, messages.at(-1).content);
  assert.ok(selected.some((message) => message.content === "Resposta intermediária 20"));
});

test("não interrompe a busca de contexto ao encontrar uma mensagem grande", () => {
  const messages = [
    turn("user", "O assunto importante é a conta do usuário."),
    turn("assistant", "Contexto inicial."),
    turn("user", "x".repeat(8000)),
    turn("assistant", "y".repeat(8000)),
    turn("user", "Preciso retomar o assunto da conta."),
  ];

  const selected = selectConversationMessages(messages, { maxMessages: 10, maxChars: 10000 });
  assert.equal(selected[0].content, messages[0].content);
  assert.equal(selected.at(-1).content, messages.at(-1).content);
  assert.ok(selected.some((message) => message.content === "Contexto inicial."));
});
