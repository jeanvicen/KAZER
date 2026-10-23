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
const PRESETS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" },
  anthropic: { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest" },
  custom: { label: "Outra (compatível com OpenAI)", baseUrl: "", model: "" },
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
      return sendJson(response, 200, { flame: keyForClient(row), presets: Object.entries(PRESETS).map(([id, preset]) => ({ id, ...preset })) });
    }
    if (request.method === "DELETE") {
      await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { success: true });
    }
    const body = parseBody(request);
    if (!body) return badRequest(response, "JSON inválido.");
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

module.exports = { PRESETS, callFlame, cleanModel, handler, loadFlameConfig, normalizeBaseUrl };
