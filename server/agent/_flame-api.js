/*
 * KAZER — Flame API: a pessoa usa a própria chave de IA (BYOK).
 * Aceita qualquer provedor compatível com /chat/completions (OpenAI,
 * Anthropic, Gemini, Groq, OpenRouter, DeepSeek, Mistral ou URL própria).
 * A chave é cifrada no servidor e nunca volta ao navegador; a URL passa
 * pela política anti-SSRF antes de cada chamada.
 */
const { decryptSecret, encryptSecret, requireUser, supabaseRequest, unauthorized, badRequest } = require("../storage/_kazer-data");
const { readTextWithLimit, sendJson } = require("../security/_security");
const { parsePublicUrl, requestPublicUrl } = require("../security/_ssrf");

const TABLE = "kazer_model_keys";
// Sugestões de modelos por provedor; a lista real vem de GET {baseUrl}/models
// com a chave da pessoa (quando o provedor oferece esse endpoint).
const PRESETS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "o4-mini"] },
  anthropic: { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"] },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", model: "grok-4", models: ["grok-4", "grok-4-fast", "grok-3-mini"] },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"] },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"] },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct"] },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", models: ["openrouter/auto", "anthropic/claude-sonnet-5-5", "openai/gpt-5", "google/gemini-2.5-pro", "x-ai/grok-4", "deepseek/deepseek-chat"] },
  perplexity: { label: "Perplexity (Sonar)", baseUrl: "https://api.perplexity.ai", model: "sonar", models: ["sonar", "sonar-pro", "sonar-reasoning"] },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo"] },
  fireworks: { label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/deepseek-v3", models: ["accounts/fireworks/models/deepseek-v3", "accounts/fireworks/models/llama-v3p3-70b-instruct"] },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b", models: ["gpt-oss-120b", "llama-3.3-70b", "qwen-3-32b"] },
  sambanova: { label: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct", models: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3-0324"] },
  deepinfra: { label: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai", model: "meta-llama/Llama-3.3-70B-Instruct", models: ["meta-llama/Llama-3.3-70B-Instruct", "deepseek-ai/DeepSeek-V3"] },
  moonshot: { label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2-0905-preview", models: ["kimi-k2-0905-preview", "moonshot-v1-32k"] },
  qwen: { label: "Alibaba Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", models: ["qwen-max", "qwen-plus", "qwen-turbo"] },
  zhipu: { label: "Z.ai (GLM)", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.6", models: ["glm-4.6", "glm-4.5-air"] },
  cohere: { label: "Cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", model: "command-a-03-2025", models: ["command-a-03-2025", "command-r-plus"] },
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.3-70b-instruct", models: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"] },
  huggingface: { label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.3-70B-Instruct", models: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct"] },
  custom: { label: "Outra (compatível com OpenAI)", baseUrl: "", model: "", models: [] },
};

function normalizeBaseUrl(value) {
  const url = parsePublicUrl(String(value || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, ""), { protocols: ["https:"], allowCustomPort: true });
  return url.toString().replace(/\/$/, "");
}

function cleanModel(value) {
  const model = String(value || "").trim();
  return /^[\w.:/@-]{1,120}$/.test(model) ? model : "";
}

async function getModelKey(userId) {
  const rows = await supabaseRequest(TABLE, { query: { select: "*", user_id: `eq.${userId}`, limit: 1 } });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function keyForClient(row) {
  if (!row) return { configured: false };
  const preset = PRESETS[row.provider] || PRESETS.custom;
  return { configured: true, provider: row.provider, providerLabel: preset.label, baseUrl: row.base_url, model: row.model, updatedAt: row.updated_at };
}

// Chamada compatível com OpenAI, sempre por requestPublicUrl (sem redirect).
async function callFlame(config, body, { timeoutMs = 60_000 } = {}) {
  const response = await requestPublicUrl(`${config.baseUrl}/chat/completions`, {
    protocols: ["https:"],
    allowCustomPort: true,
    maxRedirects: 0,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.apiKey}`, ...(config.provider === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : {}) },
    body: JSON.stringify({ ...body, model: config.model }),
    maxBytes: 2 * 1024 * 1024,
    timeoutMs,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await readTextWithLimit(response, 2 * 1024 * 1024);
  let data = null;
  try { data = JSON.parse(raw || "null"); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

// Lista os modelos que a chave da pessoa enxerga (GET /models, padrão OpenAI).
async function listFlameModels(config) {
  const response = await requestPublicUrl(`${config.baseUrl}/models`, {
    protocols: ["https:"],
    allowCustomPort: true,
    maxRedirects: 0,
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${config.apiKey}`, ...(config.provider === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : {}) },
    maxBytes: 1024 * 1024,
    timeoutMs: 8000,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  let data = null;
  try { data = JSON.parse(await readTextWithLimit(response, 1024 * 1024) || "null"); } catch { return []; }
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return [...new Set(items.map((item) => cleanModel(String(item?.id || item?.name || "").replace(/^models\//, ""))).filter(Boolean))].slice(0, 200);
}

async function loadFlameConfig(userId) {
  const row = await getModelKey(userId).catch(() => null);
  if (!row) return null;
  const apiKey = decryptSecret(row.api_key_encrypted);
  if (!apiKey) return null;
  return { provider: row.provider, baseUrl: row.base_url, model: row.model, apiKey };
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

async function handler(request, response) {
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  try {
    if (request.method === "GET") {
      const row = await getModelKey(user.id);
      const result = { flame: keyForClient(row), presets: Object.entries(PRESETS).map(([id, preset]) => ({ id, ...preset })) };
      if (row && /(?:^|[?&])list=1(?:&|$)/.test(String(request.url || "").split("?")[1] || "")) {
        const config = await loadFlameConfig(user.id);
        result.models = config ? await listFlameModels(config).catch(() => []) : [];
      }
      return sendJson(response, 200, result);
    }
    if (request.method === "DELETE") {
      await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { success: true });
    }
    const body = parseBody(request);
    if (!body) return badRequest(response, "JSON inválido.");
    // Troca só o modelo, mantendo provedor e chave já salvos.
    if (body.action === "model") {
      const config = await loadFlameConfig(user.id);
      if (!config) return badRequest(response, "Configure a Flame API primeiro.");
      const nextModel = cleanModel(body.model);
      if (!nextModel) return badRequest(response, "Modelo inválido.");
      let probe;
      try { probe = await callFlame({ ...config, model: nextModel }, { messages: [{ role: "user", content: "ping" }], max_tokens: 4 }, { timeoutMs: 20_000 }); }
      catch { return badRequest(response, "Não consegui falar com o provedor agora."); }
      if (!probe.ok) return badRequest(response, `O provedor recusou o modelo ${nextModel} (HTTP ${probe.status}).`);
      const rows = await supabaseRequest(TABLE, { method: "PATCH", query: { user_id: `eq.${user.id}` }, body: { model: nextModel, updated_at: new Date().toISOString() } });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return sendJson(response, 200, { flame: keyForClient(row || { provider: config.provider, base_url: config.baseUrl, model: nextModel }) });
    }
    const provider = PRESETS[body.provider] ? body.provider : "custom";
    let baseUrl;
    try { baseUrl = normalizeBaseUrl(body.baseUrl || PRESETS[provider].baseUrl); } catch { return badRequest(response, "Informe uma URL HTTPS pública da API."); }
    const model = cleanModel(body.model || PRESETS[provider].model);
    const apiKey = String(body.apiKey || "").trim();
    if (!model) return badRequest(response, "Informe o nome do modelo.");
    if (!/^[\x21-\x7e]{12,400}$/.test(apiKey)) return badRequest(response, "Chave de API inválida.");

    // Valida a chave com uma chamada mínima antes de salvar.
    let check;
    try { check = await callFlame({ provider, baseUrl, model, apiKey }, { messages: [{ role: "user", content: "ping" }], max_tokens: 4 }, { timeoutMs: 20_000 }); }
    catch { return badRequest(response, "Não consegui falar com essa API. Confira a URL."); }
    if (!check.ok) return badRequest(response, `A API recusou a chave ou o modelo (HTTP ${check.status}).`);

    const payload = { user_id: user.id, provider, base_url: baseUrl, model, api_key_encrypted: encryptSecret(apiKey) };
    await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}` } });
    const rows = await supabaseRequest(TABLE, { method: "POST", body: payload });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return sendJson(response, 201, { flame: keyForClient(row || { ...payload, updated_at: new Date().toISOString() }) });
  } catch (error) {
    console.error("Flame API config error", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível salvar a Flame API agora." });
  }
}

module.exports = { PRESETS, callFlame, listFlameModels, cleanModel, handler, loadFlameConfig, normalizeBaseUrl };
