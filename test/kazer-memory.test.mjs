import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { KazerMemory, extractMemories, summarizeConversation } = require("../interface/kazer-memory.js");

// Shared state models persistent IndexedDB across fresh page/module instances.
const databases = new Map();
class PersistentAdapter {
  constructor(userId) {
    this.userId = userId;
    if (!databases.has(userId)) databases.set(userId, { records: new Map(), meta: new Map() });
    this.db = databases.get(userId);
  }
  async open() {}
  async getRecord(id) { return this.db.records.get(id) || null; }
  async getAllRecords() { return [...this.db.records.values()]; }
  async putRecord(record) { this.db.records.set(record.id, structuredClone(record)); }
  async deleteRecord(id) { this.db.records.delete(id); }
  async getMeta(key) { return this.db.meta.get(key); }
  async putMeta(key, value) { this.db.meta.set(key, value); }
  async addMetaIfAbsent(key, value) {
    if (this.db.meta.has(key)) throw new Error("already exists");
    this.db.meta.set(key, value);
  }
  async clearAll() { this.db.records.clear(); this.db.meta.clear(); }
  close() {}
}
function createStore(userId) { return new KazerMemory(userId, { crypto: webcrypto, adapter: new PersistentAdapter(userId) }); }

test("inicialização local pode ser repetida depois de uma falha transitória", async () => {
  databases.clear();
  const adapter = new PersistentAdapter("retry-user");
  const getMeta = adapter.getMeta.bind(adapter);
  let failOnce = true;
  adapter.getMeta = async (key) => {
    if (failOnce) { failOnce = false; throw new Error("temporary storage failure"); }
    return getMeta(key);
  };
  const store = new KazerMemory("retry-user", { crypto: webcrypto, adapter });
  await assert.rejects(() => store.ready(), /temporary storage failure/);
  assert.equal(await store.ready(), store);
});

test("memória criptografada continua disponível após reinicializar a instância", async () => {
  databases.clear();
  const first = createStore("user-a");
  await first.save({ category: "preference", content: "Prefiro respostas curtas em português." });
  const raw = databases.get("user-a").records.values().next().value;
  assert.ok(raw.ciphertext);
  assert.equal(JSON.stringify(raw).includes("respostas curtas"), false);
  first.close();

  const restarted = createStore("user-a");
  const found = await restarted.search("gosto de respostas objetivas");
  assert.equal(found.length, 1);
  assert.match(found[0].content, /respostas curtas/);
});

test("cada usuário tem registros e chave criptográfica isolados", async () => {
  databases.clear();
  const alice = createStore("alice");
  const bob = createStore("bob");
  await alice.save({ category: "fact", content: "Projeto secreto da Alice." });
  assert.equal((await bob.list()).length, 0);
  assert.notEqual(databases.get("alice").meta.get("encryptionKey"), databases.get("bob").meta.get("encryptionKey"));
  const exportAlice = await alice.exportJSON();
  await assert.rejects(() => bob.importData(exportAlice), /outra conta/);
  const markdownAlice = await alice.exportMarkdown();
  await assert.rejects(() => bob.importData(markdownAlice), /outra conta/);
});

test("busca semântica local encontra paráfrase sem serviço externo", async () => {
  databases.clear();
  const store = createStore("semantic-user");
  await store.save({ category: "preference", content: "Prefiro carros elétricos para o próximo projeto." });
  const result = await store.search("que tipo de automóvel eu gosto?");
  assert.equal(result.length, 1);
  assert.match(result[0].content, /carros elétricos/);
});

test("exporta e restaura JSON e Markdown", async () => {
  databases.clear();
  const store = createStore("export-user");
  await store.save({ id: "pref-1", category: "preference", content: "Sempre use o português brasileiro." });
  await store.save({ id: "task-1", category: "task", content: "Pendência: revisar o módulo de memória." });
  const json = await store.exportJSON();
  const markdown = await store.exportMarkdown();
  assert.match(json, /schemaVersion/);
  assert.match(markdown, /# Memórias locais do KAZER/);
  await store.clear();
  assert.equal((await store.list()).length, 0);
  assert.equal(await store.importData(json), 2);
  assert.equal((await store.list()).length, 2);
  await store.clear();
  assert.equal(await store.importData(markdown), 2);
  const restored = await store.list();
  assert.equal(restored.length, 2);
  assert.ok(restored.some((entry) => entry.category === "task"));
});

test("modo privado bloqueia gravação, contexto compartilhado e importação", async () => {
  databases.clear();
  const store = createStore("private-user");
  await store.save({ category: "fact", content: "Memória já existente." });
  assert.equal((await store.getPreferences()).shareContext, false);
  assert.equal(await store.contextFor("memória"), "");
  await store.setPreferences({ shareContext: true });
  assert.notEqual(await store.contextFor("memória"), "");
  await store.setPreferences({ privateMode: true });
  assert.equal((await store.getPreferences()).shareContext, false);
  assert.equal(await store.contextFor("memória"), "");
  assert.equal(await store.save({ category: "fact", content: "Não salvar isto." }), null);
  assert.equal((await store.list()).length, 1);
  await assert.rejects(() => store.importData(JSON.stringify({ userId: "private-user", memories: [{ category: "fact", content: "restaurar" }] })), /modo privado/);
});

test("apagar tudo remove registros e chave local", async () => {
  databases.clear();
  const store = createStore("delete-user");
  await store.save({ category: "fact", content: "Apagar completamente." });
  assert.ok(databases.get("delete-user").meta.has("encryptionKey"));
  await store.clear();
  assert.equal(databases.get("delete-user").records.size, 0);
  assert.equal(databases.get("delete-user").meta.size, 0);
  assert.equal((await store.list()).length, 0);
});

test("extrai perfil, preferência, decisão e tarefa, mas rejeita segredos", () => {
  const entries = extractMemories([
    { role: "user", content: "Meu nome é Jean." },
    { role: "user", content: "Prefiro interfaces simples." },
    { role: "user", content: "Decidimos usar IndexedDB no projeto." },
    { role: "user", content: "Preciso revisar os testes amanhã." },
    { role: "user", content: "Minha API key: sk-example-secret-token" },
  ]);
  assert.ok(entries.some((entry) => entry.category === "profile"));
  assert.ok(entries.some((entry) => entry.category === "preference"));
  assert.ok(entries.some((entry) => entry.category === "decision"));
  assert.ok(entries.some((entry) => entry.category === "task"));
  assert.equal(entries.some((entry) => /API key/i.test(entry.content)), false);
  assert.equal(summarizeConversation([{ role: "user", content: "Olá" }, { role: "assistant", content: "Oi" }], "chat-1").category, "conversation");
});
