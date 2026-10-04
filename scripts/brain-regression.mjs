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
assert.equal(classifyTask("Build me a login system with Supabase and make sure the user session survives refresh."), "coding");
assert.equal(classifyTask("Why is this function crashing?"), "coding");
assert.equal(classifyTask("Analyze this repository and tell me what is wrong.", { hasRepository: true }), "analysis");
assert.equal(classifyTask("Create a dashboard with authentication."), "coding");
assert.equal(classifyTask("Find the bug and fix it."), "coding");
assert.equal(classifyTask("Me dê o código completo do index.html"), "coding");
assert.equal(planTask("Crie o arquivo index.html completo").taskType, "coding");
assert.equal(classifyTask("Monte um diagrama do fluxo"), "visual");
assert.equal(classifyTask("Analise o PDF anexado", { hasFiles: true }), "analysis");
const engineeringPlan = planTask("Build me a login system with Supabase and make sure the user session survives refresh.");
assert.equal(engineeringPlan.taskType, "coding");
assert.equal(engineeringPlan.needsValidation, true);
assert.equal(engineeringPlan.multiStep, true);
assert.equal(engineeringPlan.complexity, "complex");
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
assert.ok(buildSystemInstructions({ taskType: "coding" }).includes("Não use kazer-html, kazer-svg"));
const codingPrompt = buildSystemInstructions({ taskType: "coding" });
assert.ok(codingPrompt.includes("loop principal") && codingPrompt.includes("colisão"), "O modo coding não cobre engenharia de jogos");
assert.ok(codingPrompt.includes("Não corte código importante"), "O modo coding ainda não orienta respostas grandes");
const visualPrompt = buildSystemInstructions({ taskType: "visual" });
assert.ok(visualPrompt.includes("pelo menos três camadas") && visualPrompt.includes("quadrados"), "A direção de arte visual não evita composições genéricas");
assert.ok(visualPrompt.includes("viewBox") && visualPrompt.includes("gradientes"), "A direção de arte visual não exige SVG responsivo e rico");

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
const codingProviderEnv = { HF_TOKEN: process.env.HF_TOKEN, GROQ_API_KEY: process.env.GROQ_API_KEY, KAZER_PROVIDER_ORDER: process.env.KAZER_PROVIDER_ORDER };
try {
  process.env.HF_TOKEN = "hf-test";
  delete process.env.GROQ_API_KEY;
  delete process.env.KAZER_PROVIDER_ORDER;
  assert.deepEqual(brain.configuredProviderOrder("", "coding"), ["huggingface"]);
  assert.equal(brain.providerConfig(false, "", "", "coding").models[0], "Qwen/Qwen3-Coder-30B-A3B-Instruct");
} finally {
  for (const [key, value] of Object.entries(codingProviderEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
const providerKeys = ["GROQ_API_KEY", "HF_TOKEN", "KAZER_PROVIDER_ORDER", "GROQ_CHAT_ENDPOINT", "HF_CHAT_ENDPOINT"];
const savedProviderEnv = Object.fromEntries(providerKeys.map((key) => [key, process.env[key]]));
const savedFetch = globalThis.fetch;
const attemptedModels = [];
try {
  process.env.GROQ_API_KEY = "test-groq-token";
  process.env.HF_TOKEN = "test-hf-token";
  process.env.GROQ_CHAT_ENDPOINT = "https://groq.example/chat";
  process.env.HF_CHAT_ENDPOINT = "https://hf.example/chat";
  delete process.env.KAZER_PROVIDER_ORDER;
  globalThis.fetch = async (_url, init = {}) => {
    const model = JSON.parse(init.body).model;
    attemptedModels.push(model);
    const message = model.startsWith("Qwen/Qwen3-30B")
      ? { role: "assistant", content: "Fallback validado.", tool_calls: [] }
      : { role: "assistant", content: "", tool_calls: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message }] }) };
  };
  const recovered = await brain.callKazerBrain({
    messages: [{ role: "user", content: "Busque fontes para esta resposta." }],
    tools: [{ type: "function", function: { name: "research_web", parameters: { type: "object" } } }],
    maxAttempts: 1,
  });
  assert.equal(recovered.provider, "hf");
  assert.equal(recovered.data.choices[0].message.content, "Fallback validado.");
  assert.equal(attemptedModels.length, 3, "respostas vazias com tool_calls=[] devem acionar fallback de modelo e provedor");
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedProviderEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log("brain-regression: OK — intenção, plano, contexto, roteamento e recuperação de resposta vazia verificados.");
