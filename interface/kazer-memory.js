/*
 * KAZER local-first memory module.
 * Persistent content is encrypted with AES-256-GCM in a user-scoped IndexedDB.
 * No network calls, telemetry, Mem0 service, or OpenMemory server are made here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KazerMemoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const DB_PREFIX = "kazer-local-memory-v1-";
  const CATEGORIES = new Set(["profile", "preference", "decision", "task", "conversation", "fact"]);
  const encoder = () => new TextEncoder();
  const decoder = () => new TextDecoder();
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const clean = (value, max = 4000) => String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

  const SYNONYM_GROUPS = [
    "carro carros automovel automoveis veiculo veiculos automotivo",
    "preferencia preferencias prefiro prefere gosto gostar preferir preference prefer",
    "tarefa tarefas pendente pendentes afazer task todo",
    "trabalho emprego carreira profissional work job",
    "treino treinar exercicio exercicios academia fitness workout",
    "projeto projetos produto produtos project product repositorio codigo codebase",
    "idioma lingua linguas portugues ingles language",
    "privacidade privado privada sigilo confidencial privacy private",
    "familia parentes casa lar family",
    "comida alimento alimentos receita culinaria food meal",
    "estudo estudar curso cursos escola faculdade learn study",
    "decisao decidido decidimos decidi escolha definido decision",
  ].map((group) => group.split(" "));
  const SYNONYMS = new Map();
  for (const group of SYNONYM_GROUPS) for (const word of group) SYNONYMS.set(word, group);

  function tokens(value) {
    return normalize(value).match(/[a-z0-9]+/g) || [];
  }

  function expandedTokens(value) {
    const result = new Set();
    for (const token of tokens(value)) {
      result.add(token);
      for (const synonym of SYNONYMS.get(token) || []) result.add(synonym);
    }
    return result;
  }

  function semanticScore(query, memory) {
    const queryTokens = expandedTokens(query);
    if (!queryTokens.size) return 0;
    const body = `${memory.content || ""} ${(memory.tags || []).join(" ")} ${memory.category || ""}`;
    const memoryTokens = expandedTokens(body);
    let overlap = 0;
    for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
    const lexical = normalize(body).includes(normalize(query).trim()) ? 1 : 0;
    return lexical || overlap ? (lexical * 0.7) + (overlap / Math.sqrt(queryTokens.size * Math.max(1, memoryTokens.size))) : 0;
  }

  function bytesToBase64(bytes) {
    if (typeof btoa === "function") {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
  }

  function base64ToBytes(value) {
    if (typeof atob === "function") {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    });
  }

  class IndexedDBAdapter {
    constructor(userId, indexedDB = globalThis.indexedDB) {
      const id = String(userId || "");
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("A valid authenticated user ID is required.");
      if (!indexedDB) throw new Error("This browser does not support local IndexedDB storage.");
      this.userId = id;
      this.indexedDB = indexedDB;
      this.name = DB_PREFIX + id;
      this.dbPromise = null;
    }

    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.name, VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        let settled = false;
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          settled = true;
          resolve(request.result);
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          this.dbPromise = null;
          reject(request.error || new Error("Could not open local memory storage."));
        };
        request.onblocked = () => {
          if (settled) return;
          settled = true;
          this.dbPromise = null;
          reject(new Error("Close other KAZER tabs to initialize local memory."));
        };
      });
      return this.dbPromise;
    }

    async getRecord(id) {
      const db = await this.open();
      const tx = db.transaction("records", "readonly");
      const done = transactionDone(tx);
      const record = await requestValue(tx.objectStore("records").get(id));
      await done;
      return record || null;
    }

    async getAllRecords() {
      const db = await this.open();
      const tx = db.transaction("records", "readonly");
      const done = transactionDone(tx);
      const records = await requestValue(tx.objectStore("records").getAll());
      await done;
      return records || [];
    }

    async putRecord(record) {
      const db = await this.open();
      const tx = db.transaction("records", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("records").put(record);
      await done;
    }

    async deleteRecord(id) {
      const db = await this.open();
      const tx = db.transaction("records", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("records").delete(id);
      await done;
    }

    async getMeta(key) {
      const db = await this.open();
      const tx = db.transaction("meta", "readonly");
      const done = transactionDone(tx);
      const entry = await requestValue(tx.objectStore("meta").get(key));
      await done;
      return entry ? entry.value : undefined;
    }

    async putMeta(key, value) {
      const db = await this.open();
      const tx = db.transaction("meta", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("meta").put({ key, value });
      await done;
    }

    async addMetaIfAbsent(key, value) {
      const db = await this.open();
      const tx = db.transaction("meta", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("meta").add({ key, value });
      await done;
    }

    async clearAll() {
      const db = await this.open();
      const tx = db.transaction(["records", "meta"], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("records").clear();
      tx.objectStore("meta").clear();
      await done;
    }

    close() {
      if (!this.dbPromise) return;
      void this.dbPromise.then((db) => db.close()).catch(() => {});
      this.dbPromise = null;
    }
  }

  class KazerMemory {
    constructor(userId, options = {}) {
      this.userId = String(userId || "");
      this.crypto = options.crypto || globalThis.crypto;
      if (!this.crypto?.subtle || !this.crypto?.getRandomValues) throw new Error("Web Crypto is required for encrypted local memory.");
      this.adapter = options.adapter || new IndexedDBAdapter(this.userId, options.indexedDB);
      this.key = null;
      this.keyPromise = null;
      this.readyPromise = null;
    }

    ready() {
      if (!this.readyPromise) {
        const pending = (async () => {
          await this.adapter.open?.();
          this.key = await this.adapter.getMeta("encryptionKey") || null;
          return this;
        })();
        const wrapped = pending.catch((error) => {
          if (this.readyPromise === wrapped) this.readyPromise = null;
          this.key = null;
          throw error;
        });
        this.readyPromise = wrapped;
      }
      return this.readyPromise;
    }

    async _ensureKey() {
      await this.ready();
      if (this.key) return this.key;
      if (this.keyPromise) return this.keyPromise;
      this.keyPromise = (async () => {
        const candidate = await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        try {
          await this.adapter.addMetaIfAbsent("encryptionKey", candidate);
          this.key = candidate;
        } catch (error) {
          const winner = await this.adapter.getMeta("encryptionKey");
          if (!winner) throw error;
          this.key = winner;
        }
        return this.key;
      })();
      try { return await this.keyPromise; }
      finally { this.keyPromise = null; }
    }

    async _encrypt(id, value) {
      const key = await this._ensureKey();
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const additionalData = encoder().encode(`${this.userId}:${id}:${VERSION}`);
      const cleartext = encoder().encode(JSON.stringify(value));
      const ciphertext = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData, tagLength: 128 }, key, cleartext);
      return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
    }

    async _decrypt(record) {
      await this.ready();
      const key = this.key;
      if (!key) throw new Error("The local memory encryption key is missing.");
      const additionalData = encoder().encode(`${this.userId}:${record.id}:${VERSION}`);
      const cleartext = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv), additionalData, tagLength: 128 }, key, base64ToBytes(record.ciphertext));
      const data = JSON.parse(decoder().decode(cleartext));
      return { ...record, content: data.content, tags: data.tags || [] };
    }

    async getPreferences() {
      await this.ready();
      return {
        privateMode: (await this.adapter.getMeta("privateMode")) === true,
        shareContext: (await this.adapter.getMeta("shareContext")) === true,
      };
    }

    async setPreferences(patch = {}) {
      await this.ready();
      const current = await this.getPreferences();
      const next = { ...current, ...patch };
      next.privateMode = Boolean(next.privateMode);
      next.shareContext = next.privateMode ? false : Boolean(next.shareContext);
      await this.adapter.putMeta("privateMode", next.privateMode);
      await this.adapter.putMeta("shareContext", next.shareContext);
      return next;
    }

    async list(options = {}) {
      await this.ready();
      const category = options.category && options.category !== "all" ? String(options.category) : "";
      const query = String(options.query || "").trim();
      const records = await this.adapter.getAllRecords();
      const entries = await Promise.all(records.map((record) => this._decrypt(record)));
      const filtered = entries.filter((entry) => (!category || entry.category === category)
        && (!query || semanticScore(query, entry) > 0));
      if (query) filtered.sort((a, b) => semanticScore(query, b) - semanticScore(query, a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      else filtered.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return filtered;
    }

    async search(query, options = {}) {
      const text = String(query || "").trim();
      const entries = await this.list({ query: text });
      return entries.slice(0, Math.max(1, Math.min(Number(options.limit) || 6, 20)));
    }

    async save(input = {}) {
      await this.ready();
      const prefs = await this.getPreferences();
      if (prefs.privateMode) return null;
      const content = clean(input.content, 4000);
      const category = CATEGORIES.has(input.category) ? input.category : "fact";
      if (!content) throw new Error("Memory content cannot be empty.");
      const now = new Date().toISOString();
      const id = clean(input.id, 140) || this.crypto.randomUUID?.() || bytesToBase64(this.crypto.getRandomValues(new Uint8Array(18)));
      let existing = null;
      if (input.id) {
        const stored = await this.adapter.getRecord(id);
        if (stored) existing = await this._decrypt(stored);
      } else {
        const duplicate = (await this.list()).find((entry) => entry.category === category && normalize(entry.content) === normalize(content));
        if (duplicate) return duplicate;
      }
      const createdAt = input.createdAt || existing?.createdAt || now;
      const updatedAt = input.updatedAt || now;
      const tags = Array.isArray(input.tags) ? input.tags.map((tag) => clean(tag, 80)).filter(Boolean).slice(0, 12) : [];
      const encrypted = await this._encrypt(id, { content, tags });
      const record = { id, category, createdAt, updatedAt, ...encrypted };
      await this.adapter.putRecord(record);
      return { ...record, content, tags };
    }

    async remove(id) {
      await this.ready();
      await this.adapter.deleteRecord(String(id));
    }

    async clear() {
      await this.adapter.clearAll();
      this.key = null;
      this.keyPromise = null;
      this.readyPromise = null;
    }

    async exportJSON() {
      const memories = await this.list();
      return JSON.stringify({ schemaVersion: VERSION, userId: this.userId, exportedAt: new Date().toISOString(), memories }, null, 2);
    }

    async exportMarkdown() {
      const memories = await this.list();
      const header = `# Memórias locais do KAZER\n\n<!-- kazer-memory-export:${JSON.stringify({ schemaVersion: VERSION, userId: this.userId })} -->`;
      const blocks = memories.map((entry) => `<!-- kazer-memory:${JSON.stringify({ id: entry.id, category: entry.category, createdAt: entry.createdAt, updatedAt: entry.updatedAt, tags: entry.tags })} -->\n\n${entry.content}`);
      return [header, ...blocks].join("\n\n---\n\n") + "\n";
    }

    async importData(raw) {
      const prefs = await this.getPreferences();
      if (prefs.privateMode) throw new Error("Desative o modo privado para importar memórias.");
      const text = String(raw || "").trim();
      if (!text) throw new Error("O arquivo está vazio.");
      let payload;
      try { payload = JSON.parse(text); } catch { payload = parseMarkdown(text); }
      if (payload.userId && payload.userId !== this.userId) throw new Error("Este arquivo pertence a outra conta. A importação foi bloqueada para preservar o isolamento.");
      const source = Array.isArray(payload) ? payload : payload.memories;
      if (!Array.isArray(source)) throw new Error("Não encontrei memórias válidas no arquivo.");
      let imported = 0;
      for (const entry of source) {
        if (!entry || typeof entry !== "object" || !CATEGORIES.has(entry.category) || !clean(entry.content)) continue;
        await this.save({ ...entry, content: clean(entry.content), id: clean(entry.id, 140) || undefined });
        imported += 1;
      }
      if (!imported) throw new Error("O arquivo não contém memórias válidas.");
      return imported;
    }

    async contextFor(query, options = {}) {
      const prefs = await this.getPreferences();
      if (prefs.privateMode || !prefs.shareContext || !String(query || "").trim()) return "";
      const hits = await this.search(query, { limit: options.limit || 5 });
      const latestPrefs = await this.getPreferences();
      if (latestPrefs.privateMode || !latestPrefs.shareContext || !hits.length) return "";
      const maxChars = Math.max(200, Math.min(Number(options.maxChars) || 1400, 4000));
      const lines = [];
      let total = 0;
      for (const hit of hits) {
        const line = `- [${hit.category}] ${hit.content}`;
        if (total + line.length > maxChars) break;
        lines.push(line);
        total += line.length;
      }
      return lines.length ? `\n\n[Memórias locais relevantes — compartilhadas com a IA conforme sua autorização. Use apenas o que for pertinente.]\n${lines.join("\n")}\n[Fim das memórias locais]` : "";
    }

    close() { this.adapter.close?.(); }
  }

  function parseMarkdown(text) {
    const exportMatch = text.match(/<!--\s*kazer-memory-export:(\{[^\n]*\})\s*-->/);
    let userId = "";
    if (exportMatch) { try { userId = JSON.parse(exportMatch[1]).userId || ""; } catch {} }
    const marker = /<!--\s*kazer-memory:(\{[^\n]*\})\s*-->\s*\n([\s\S]*?)(?=\n\s*---\s*\n\s*<!--\s*kazer-memory:|$)/g;
    const memories = [];
    let match;
    while ((match = marker.exec(text))) {
      try {
        const meta = JSON.parse(match[1]);
        const content = match[2].replace(/^\s+|\s+$/g, "");
        if (content) memories.push({ ...meta, content });
      } catch {}
    }
    return { userId, memories };
  }

  const SECRET_PATTERN = /(?:password|senha|api[\s_-]?key|token|secret|chave privada|cart[aã]o de cr[eé]dito)\s*[:=]?\s*\S+/i;
  function safeMemoryText(value) {
    const text = clean(value, 2400);
    if (!text || SECRET_PATTERN.test(text) || /\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,})\b/i.test(text)) return "";
    return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail] ").trim();
  }

  function extractMemories(messages = []) {
    const found = [];
    const add = (category, content) => {
      const safe = safeMemoryText(content);
      if (safe && !found.some((item) => item.category === category && normalize(item.content) === normalize(safe))) found.push({ category, content: safe });
    };
    for (const message of (Array.isArray(messages) ? messages : []).filter((item) => item?.role === "user").slice(-12)) {
      const text = safeMemoryText(message.content);
      if (!text) continue;
      const name = text.match(/(?:meu nome [eé]|me chamo|pode me chamar de|my name is)\s+([\p{L}][\p{L}' -]{0,49})/iu);
      if (name) add("profile", `O nome do usuário é ${name[1].replace(/[.,!?].*$/, "").trim()}.`);
      if (/\b(prefiro|gosto de|nao gosto de|não gosto de|sempre|nunca|quero que|i prefer|i like|i don't like|always|never)\b/i.test(text)) add("preference", text);
      if (/\b(decidi|decidimos|ficou definido|vamos usar|a escolha foi|aprovado|we decided|we will use|decision is)\b/i.test(text)) add("decision", text);
      if (/\b(preciso|tenho que|devo|vou (?:fazer|concluir|enviar|ligar|resolver)|me lembra|não esquecer|nao esquecer|pendente|todo|i need to|i have to|remind me)\b/i.test(text)) add("task", text);
      if (/\b(lembre|anote|saiba que|meu projeto|sobre mim|para o kazer|for my project|remember that)\b/i.test(text)) add("fact", text);
    }
    return found.slice(0, 8);
  }

  function summarizeConversation(messages = [], chatId = "") {
    const recent = (Array.isArray(messages) ? messages : []).filter((message) => ["user", "assistant"].includes(message?.role)).slice(-4);
    if (!recent.some((item) => item.role === "user") || !recent.some((item) => item.role === "assistant")) return null;
    const snippets = recent.map((item) => `${item.role === "user" ? "Usuário" : "KAZER"}: ${safeMemoryText(item.content)}`).filter((item) => !item.endsWith(": "));
    if (!snippets.length) return null;
    return {
      id: `conversation-${String(chatId || "latest").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100) || "latest"}`,
      category: "conversation",
      content: `Resumo local da conversa:\n${snippets.join("\n")}`.slice(0, 1200),
      tags: ["contexto de conversa"],
    };
  }

  return { VERSION, CATEGORIES: [...CATEGORIES], IndexedDBAdapter, KazerMemory, semanticScore, extractMemories, summarizeConversation, parseMarkdown };
});
