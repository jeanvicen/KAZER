const {
  getBearerToken,
  publicSupabaseAnonKey,
  supabaseBaseUrl,
} = require("./_security");

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || publicSupabaseAnonKey();

async function callUsageRpc(request, name, args = {}) {
  const token = getBearerToken(request);
  const baseUrl = supabaseBaseUrl();
  if (!token || !baseUrl) throw Object.assign(new Error("usage_auth_missing"), { code: "not_authenticated" });

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || data?.error || "usage_rpc_failed");
    error.status = response.status;
    error.code = [
      "credits_limit_reached",
      "usage_limit_reached",
      "attachment_limit_reached",
      "not_authenticated",
      "invalid_credit_amount",
      "invalid_attachment_count",
    ].includes(data?.message) ? data.message : data?.code || "usage_rpc_failed";
    throw error;
  }
  return Array.isArray(data) ? data[0] || {} : data || {};
}

function calculateChatCreditCost(messages, attachmentCount = 0, mcpCount = 0) {
  const history = Array.isArray(messages) ? messages : [{ content: String(messages || "") }];
  const latestPrompt = String(history.at(-1)?.content || "");
  const source = history.map((message) => String(message?.content || "")).join("\n");
  const codingRequest = /\b(?:c[oó]digo|site|app|aplicativo|reposit[oó]rio|implementar|construir|programa|fun[cç][aã]o|bug|corrigir|deploy|projeto)\b/i.test(source);
  const visualRequest = /\b(?:imagem|visual|desenho|logo|[ií]cone|layout|interface|tela|prot[oó]tipo|mockup|wireframe|diagrama|gr[aá]fico|dashboard|slide|design)\b/i.test(latestPrompt);
  // A contagem exata varia por modelo e formato da requisição. Esta reserva
  // usa uma aproximação conservadora da entrada e pesos de complexidade.
  const estimatedInputTokens = Math.ceil(source.length / 4);
  const lengthCost = Math.min(36, Math.ceil(Math.max(0, estimatedInputTokens - 250) / 250) * 3);
  const taskCost = codingRequest ? 12 : 0;
  const visualCost = visualRequest ? 5 : 0;
  const attachmentCost = Math.min(40, Math.max(0, Number(attachmentCount) || 0) * 8);
  const mcpCost = Math.min(30, Math.max(0, Number(mcpCount) || 0) * 5);
  return Math.max(10, Math.min(1000, 10 + lengthCost + taskCost + visualCost + attachmentCost + mcpCost));
}

function calculateWebSearchCreditCost(query, mode = "all", sourceCount = 0) {
  const normalizedMode = String(mode || "all");
  const modeCost = normalizedMode === "all" || normalizedMode === "web" ? 0 : 5;
  const queryCost = Math.min(10, Math.ceil(String(query || "").length / 60) * 2);
  const sourceCost = Math.min(12, Math.max(0, Number(sourceCount) || 0));
  return Math.max(20, Math.min(80, 20 + modeCost + queryCost + sourceCost));
}

module.exports = { callUsageRpc, calculateChatCreditCost, calculateWebSearchCreditCost };
