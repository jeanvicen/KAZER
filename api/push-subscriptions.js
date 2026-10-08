const { requireUser, supabaseRequest, unauthorized } = require("./_kazer-data");
const { applyRateLimit, rateLimit, sendJson } = require("./_security");

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

module.exports = async function handler(request, response) {
  if (!["POST", "DELETE"].includes(request.method)) { response.setHeader("Allow", "POST, DELETE"); return sendJson(response, 405, { error: "Método não permitido." }); }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  const limit = rateLimit(request, "push-subscription-user", { limit: 10, windowMs: 60_000, identity: user.id }); applyRateLimit(response, limit);
  if (!limit.allowed) return sendJson(response, 429, { error: "Aguarde antes de alterar as notificações." });
  const body = parseBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "JSON inválido." });
  const token = String(body.token || "").trim();
  if (!/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9._-]{8,200}\]$/.test(token)) return sendJson(response, 400, { error: "Token de notificação inválido." });
  const platform = ["android", "ios"].includes(body.platform) ? body.platform : "android";

  try {
    const existing = await supabaseRequest("kazer_push_subscriptions", {
      query: { select: "id", endpoint: `eq.${token}`, user_id: `eq.${user.id}`, limit: 1 },
    });
    const row = Array.isArray(existing) ? existing[0] : null;
    if (request.method === "DELETE") {
      if (row) await supabaseRequest("kazer_push_subscriptions", { method: "DELETE", query: { id: `eq.${row.id}`, user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { registered: false });
    }
    const payload = { user_id: user.id, endpoint: token, platform, updated_at: new Date().toISOString() };
    if (row) {
      await supabaseRequest("kazer_push_subscriptions", { method: "PATCH", query: { id: `eq.${row.id}`, user_id: `eq.${user.id}` }, body: payload });
    } else {
      await supabaseRequest("kazer_push_subscriptions", { method: "POST", body: payload });
    }
    return sendJson(response, 200, { registered: true });
  } catch (error) {
    console.error("Push subscription update failed", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível registrar as notificações neste momento." });
  }
};
