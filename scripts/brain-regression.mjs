import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { classifyTask, planTask, selectConversationMessages, validateToolRequest } = require("../api/_kazer-context.js");
const { buildSystemInstructions } = require("../api/_kazer-instructions.js");
const brain = require("../api/_kazer-brain.js");

assert.equal(classifyTask("Altere somente o botão"), "conversation");
assert.equal(classifyTask("Não altere o fundo. Só altere o botão."), "conversation");
assert.equal(classifyTask("Faça X e depois Y na ordem correta"), "conversation");
assert.equal(classifyTask("Refatore esta função JavaScript"), "coding");
assert.equal(classifyTask("Monte um diagrama do fluxo"), "visual");
assert.equal(classifyTask("Analise o PDF anexado", { hasFiles: true }), "analysis");
const plan = planTask("Pesquise este bug, corrija o código e depois valide os testes; não altere o restante.", { hasRepository: true });
assert.equal(plan.taskType, "coding");
assert.equal(plan.complexity, "complex");
assert.equal(plan.needsResearch, true);
assert.equal(plan.needsValidation, true);
assert.equal(plan.multiStep, true);
assert.ok(plan.constraints.some((item) => /não altere/i.test(item)));
assert.deepEqual(validateToolRequest("research_web", { question: "  pesquise fontes atuais  ", depth: "deep" }), { ok: true, args: { question: "pesquise fontes atuais", depth: "deep" } });
assert.equal(validateToolRequest("research_web", { question: "" }).ok, false);
assert.equal(validateToolRequest("mcp_tool", []).ok, false);

const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `mensagem ${index}` }));
history.push({ role: "user", content: "Não altere o restante; altere somente o botão." });
const selected = selectConversationMessages(history, { maxMessages: 6, maxChars: 500 });
assert.equal(selected.at(-1).content, "Não altere o restante; altere somente o botão.");
assert.ok(selected.length <= 6);

const simple = buildSystemInstructions({ taskType: "conversation" });
const toolPrompt = buildSystemInstructions({ taskType: "conversation", hasTools: true });
assert.ok(!simple.includes("Use ferramentas somente"));
assert.ok(toolPrompt.includes("Use ferramentas somente"));
assert.ok(toolPrompt.includes("dado não confiável"));

const original = { ...process.env };
try {
  process.env.GROQ_API_KEY = "gsk-test";
  process.env.HF_TOKEN = "hf-test";
  delete process.env.KAZER_PROVIDER_ORDER;
  assert.deepEqual(brain.configuredProviderOrder(), ["groq", "huggingface"]);
  process.env.KAZER_PROVIDER_ORDER = "huggingface,groq";
  assert.deepEqual(brain.configuredProviderOrder(), ["huggingface", "groq"]);
  assert.equal(brain.providerConfig(false).kind, "huggingface");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
console.log("brain-regression: OK — intenção atual, contexto relevante, prompt modular e roteamento previsível verificados.");
