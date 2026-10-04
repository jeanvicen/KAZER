/*
 * KAZER — cérebro interno kazer.v1.
 * O nome do provedor e dos modelos nunca é enviado ao cliente.
 * A política é determinística: coding usa DeepSeek > Qwen Coder; as demais tarefas usam a ordem configurada.
 */
const { readTextWithLimit } = require("./_security");
const KAZER_BRAIN_VERSION = "kazer.v1.2";
const DEFAULTS = {
  deepseek: { text: "deepseek-flash", coding: "deepseek-v4-pro", fallback: "deepseek-flash" },
  groq: { text: "openai/gpt-oss-120b", vision: "qwen/qwen3.8-27b", fallback: "qwen/qwen3.6-27b" },
  huggingface: { text: "Qwen/Qwen3-30B-A3B-Instruct-2507", coding: "Qwen/Qwen3-Coder-30B-A3B-Instruct", vision: "google/gemma-3-4b-it", fallback: "Qwen/Qwen3-4B-Instruct-2507" },
};
const ENDPOINTS = { deepseek: "https://api.deepseek.com/chat/completions", groq: "https://api.groq.com/openai/v1/chat/completions", huggingface: "https://router.huggingface.co/v1/chat/completions" };
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const PROVIDER_ORDER = ["groq", "huggingface", "deepseek"];
const CODING_PROVIDER_ORDER = ["deepseek", "huggingface"];
function clean(value) { return String(value || "").trim(); }
function uniqueModels(values) { return values.map(clean).filter((value, index, list) => value && list.indexOf(value) === index); }
function isConfigured(provider) {
  if (provider === "groq") return Boolean(clean(process.env.GROQ_API_KEY));
  if (provider === "deepseek") return Boolean(clean(process.env.DEEPSEEK_API_KEY));
  return Boolean(clean(process.env.HF_TOKEN));
}
function providerToken(provider) {
  if (provider === "groq") return clean(process.env.GROQ_API_KEY);
  if (provider === "deepseek") return clean(process.env.DEEPSEEK_API_KEY);
  return clean(process.env.HF_TOKEN);
}
function providerLabel(provider) { return provider === "huggingface" ? "hf" : provider === "deepseek" ? "deepseek" : "legacy"; }
function getReasoningEffort() {
  const value = clean(process.env.KAZER_REASONING_EFFORT || process.env.GROQ_REASONING_EFFORT || "medium").toLowerCase();
  return new Set(["none", "low", "medium", "high", "xhigh"]).has(value) ? value : "medium";
}
function configuredProviderOrder(preferredProvider = "", taskType = "conversation") {
  const configured = clean(process.env.KAZER_PROVIDER_ORDER || "").toLowerCase().split(",").map((item) => item.trim()).filter((item) => PROVIDER_ORDER.includes(item));
  const order = taskType === "coding" ? CODING_PROVIDER_ORDER : (configured.length ? configured : PROVIDER_ORDER);
  const preferred = clean(preferredProvider).toLowerCase();
  return [...new Set([preferred, ...order])].filter((provider) => order.includes(provider) && isConfigured(provider));
}
function modelList(provider, hasImages, modelOverride = "", taskType = "conversation") {
  const prefix = provider === "groq" ? "GROQ" : provider === "deepseek" ? "DEEPSEEK" : "KAZER";
  const kind = hasImages ? "VISION" : "TEXT";
  const defaults = DEFAULTS[provider];
  const legacyTextModel = provider === "groq" && !hasImages ? process.env.GROQ_MODEL : "";
  const taskModel = !hasImages && taskType === "coding" ? process.env[`${prefix}_CODE_MODEL`] : "";
  const defaultModel = !hasImages && taskType === "coding" ? (defaults.coding || defaults.text) : (hasImages ? defaults.vision : defaults.text);
  const primary = modelOverride || clean(taskModel || process.env[`${prefix}_${kind}_MODEL`] || legacyTextModel || defaultModel);
  const legacyFallback = provider === "groq" && !hasImages ? process.env.GROQ_FALLBACK_MODEL : "";
  const fallback = clean(process.env[`${prefix}_${kind}_FALLBACK_MODEL`] || (taskType === "coding" ? process.env[`${prefix}_CODE_FALLBACK_MODEL`] : "") || legacyFallback || defaults.fallback);
  return uniqueModels([primary, fallback]);
}
function providerConfig(hasImages, modelOverride = "", preferredProvider = "", taskType = "conversation") {
  const provider = configuredProviderOrder(preferredProvider, taskType)[0];
  if (!provider) return null;
  const endpointEnv = provider === "groq" ? "GROQ_CHAT_ENDPOINT" : provider === "deepseek" ? "DEEPSEEK_CHAT_ENDPOINT" : "HF_CHAT_ENDPOINT";
  return { kind: provider, token: providerToken(provider), endpoint: clean(process.env[endpointEnv]) || ENDPOINTS[provider], models: modelList(provider, hasImages, modelOverride, taskType), providerOrder: configuredProviderOrder(preferredProvider, taskType), taskType };
}
function buildProviderAttempts({ hasImages, modelOverride, preferredProvider, taskType }) {
  return configuredProviderOrder(preferredProvider, taskType).flatMap((provider) => {
    const endpointEnv = provider === "groq" ? "GROQ_CHAT_ENDPOINT" : provider === "deepseek" ? "DEEPSEEK_CHAT_ENDPOINT" : "HF_CHAT_ENDPOINT";
    const config = { kind: provider, token: providerToken(provider), endpoint: clean(process.env[endpointEnv]) || ENDPOINTS[provider], models: modelList(provider, hasImages, provider === preferredProvider ? modelOverride : "", taskType), taskType };
    return config.models.map((model) => ({ ...config, model }));
  });
}
function logFailure(attempt, failure, startedAt, capabilities = []) {
  console.warn("KAZER brain attempt failed", { provider: providerLabel(attempt.kind), model: attempt.model, task_type: attempt.taskType, capabilities: capabilities.slice(0, 8), status: failure.status || 0, reason: failure.reason || "upstream_failure", duration_ms: Date.now() - startedAt });
}
async function callKazerBrain({ messages, hasImages, tools = [], timeoutMs = 30_000, maxAttempts = 2, modelOverride = "", preferredProvider = "", taskType = "conversation", capabilities = [] }) {
  const attempts = buildProviderAttempts({ hasImages, modelOverride, preferredProvider, taskType });
  if (!attempts.length) return { failure: { status: 0, error: "brain_not_configured", reason: "no_provider_configured" } };
  let lastFailure = null;
  for (const attempt of attempts) {
    for (let retry = 0; retry < maxAttempts; retry += 1) {
      const startedAt = Date.now();
      try {
        const codeTokens = Math.max(8000, Math.min(20000, Number(process.env.KAZER_CODE_MAX_OUTPUT_TOKENS) || 12000));
        const outputTokens = taskType === "coding" ? codeTokens : 4000;
        const requestBody = { model: attempt.model, messages, temperature: hasImages ? 0.65 : taskType === "coding" ? 0.2 : 0.35, ...(attempt.kind === "groq" ? { max_completion_tokens: outputTokens } : { max_tokens: outputTokens }) };
        if (tools.length) requestBody.tools = tools;
        if (attempt.kind === "deepseek" && taskType === "coding") {
          requestBody.thinking = { type: "enabled" };
          requestBody.reasoning_effort = getReasoningEffort();
        } else if (attempt.kind === "groq" && !attempt.model.startsWith("qwen/")) requestBody.reasoning_effort = getReasoningEffort();
        const upstream = await fetch(attempt.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${attempt.token}` }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(timeoutMs) });
        const raw = await readTextWithLimit(upstream, 2 * 1024 * 1024);
        const data = JSON.parse(raw || "null");
        const message = data?.choices?.[0]?.message;
        const usable = Boolean(message) && (tools.length
          ? (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) || (typeof message.content === "string" && message.content.trim())
          : typeof message.content === "string" && message.content.trim());
        if (upstream.ok && usable) return { data, model: attempt.model, provider: providerLabel(attempt.kind), brain_version: KAZER_BRAIN_VERSION, task_type: taskType };
        lastFailure = { status: upstream.status, error: data?.error?.message || "empty_brain_response", reason: upstream.ok ? "invalid_response" : "provider_error", provider: providerLabel(attempt.kind) };
        logFailure(attempt, lastFailure, startedAt, capabilities);
        if (!RETRYABLE_STATUSES.has(upstream.status) && upstream.status !== 0) break;
      } catch (error) {
        lastFailure = { status: 0, error: error?.name === "TimeoutError" ? "brain_timeout" : "brain_network_error", reason: error?.name === "TimeoutError" ? "timeout" : "network_error", provider: providerLabel(attempt.kind) };
        logFailure(attempt, lastFailure, startedAt, capabilities);
      }
      if (retry < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (retry + 1)));
    }
  }
  return { failure: lastFailure || { status: 0, error: "brain_unavailable", reason: "all_attempts_failed" } };
}
module.exports = { KAZER_BRAIN_VERSION, callKazerBrain, providerConfig, configuredProviderOrder };
