/*
 * KAZER — cérebro interno kazer.v1.
 * O nome do provedor e dos modelos nunca é enviado ao cliente.
 */
const { readTextWithLimit } = require("./_security");

const KAZER_BRAIN_VERSION = "kazer.v1";
const DEFAULT_TEXT_MODEL = "Qwen/Qwen3-8B";
const DEFAULT_VISION_MODEL = "google/gemma-3-4b-it";
const DEFAULT_HF_ENDPOINT = "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_GROQ_TEXT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function uniqueModels(values) {
  return values.map((value) => String(value || "").trim()).filter((value, index, list) => value && list.indexOf(value) === index);
}

function providerConfig(hasImages, modelOverride = "") {
  const hfToken = String(process.env.HF_TOKEN || "").trim();
  if (hfToken) {
    const primary = modelOverride || (hasImages
      ? (process.env.KAZER_VISION_MODEL || DEFAULT_VISION_MODEL)
      : (process.env.KAZER_TEXT_MODEL || DEFAULT_TEXT_MODEL));
    const fallback = hasImages
      ? (process.env.KAZER_VISION_FALLBACK_MODEL || "Qwen/Qwen3.8-27B")
      : (process.env.KAZER_TEXT_FALLBACK_MODEL || "microsoft/Phi-4-mini-instruct");
    return {
      kind: "huggingface",
      token: hfToken,
      endpoint: String(process.env.HF_CHAT_ENDPOINT || DEFAULT_HF_ENDPOINT).trim(),
      models: uniqueModels([primary, fallback]),
    };
  }

  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (groqKey) {
    const primary = hasImages
      ? (process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL)
      : (process.env.GROQ_MODEL || DEFAULT_GROQ_TEXT_MODEL);
    const fallback = hasImages
      ? (process.env.GROQ_VISION_FALLBACK_MODEL || "qwen/qwen3.6-27b")
      : (process.env.GROQ_FALLBACK_MODEL || "qwen/qwen3.6-27b");
    return {
      kind: "groq",
      token: groqKey,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      models: uniqueModels([primary, fallback]),
    };
  }

  return null;
}

function providerLabel(kind) {
  return kind === "huggingface" ? "hf" : "legacy";
}

function getReasoningEffort() {
  const value = String(process.env.KAZER_REASONING_EFFORT || process.env.GROQ_REASONING_EFFORT || "medium").toLowerCase();
  return new Set(["none", "low", "medium", "high", "xhigh"]).has(value) ? value : "medium";
}

async function callKazerBrain({ messages, hasImages, tools = [], timeoutMs = 30_000, maxAttempts = 2, modelOverride = "" }) {
  const config = providerConfig(hasImages, modelOverride);
  if (!config) return { failure: { status: 0, error: "brain_not_configured" } };
  let lastFailure = null;

  for (const model of config.models) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const requestBody = {
          model,
          messages,
          temperature: hasImages ? 0.7 : 0.6,
          ...(config.kind === "groq" ? { max_completion_tokens: 2200 } : { max_tokens: 2200 }),
        };
        if (tools.length) requestBody.tools = tools;
        if (config.kind === "groq" && !model.startsWith("qwen/")) requestBody.reasoning_effort = getReasoningEffort();

        const upstream = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const raw = await readTextWithLimit(upstream, 2 * 1024 * 1024);
        const data = JSON.parse(raw || "null");
        const choice = data?.choices?.[0];
        const usable = Boolean(choice?.message) && (tools.length
          ? Array.isArray(choice.message.tool_calls) || typeof choice.message.content === "string"
          : typeof choice.message.content === "string" && choice.message.content.trim());
        if (upstream.ok && usable) return { data, model, provider: providerLabel(config.kind), brain_version: KAZER_BRAIN_VERSION };
        lastFailure = { status: upstream.status, error: data?.error?.message || "empty_brain_response", provider: providerLabel(config.kind) };
        if (!RETRYABLE_STATUSES.has(upstream.status)) break;
      } catch (error) {
        lastFailure = { status: 0, error: error?.message || "brain_network_error", provider: providerLabel(config.kind) };
      }
      if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  return { failure: lastFailure || { status: 0, error: "brain_unavailable" } };
}

module.exports = { KAZER_BRAIN_VERSION, callKazerBrain, providerConfig };
