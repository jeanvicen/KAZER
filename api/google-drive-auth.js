const { authenticateUser, applyRateLimit, isSameOrigin, hasSafeFetchMetadata, rateLimit, sendJson } = require("./_security");
const { authorizationUrl } = require("./_google-drive");
module.exports = async (request, response) => {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Método não permitido." }, { Allow: "GET" });
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return sendJson(response, 403, { error: "Origem não permitida." });
  const limit = rateLimit(request, "google-drive-auth", { limit: 10, windowMs: 60000 }); limit.limit = 10; applyRateLimit(response, limit); if (!limit.allowed) return sendJson(response, 429, { error: "Tente novamente em instantes." });
  const user = await authenticateUser(request); if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
  try { return sendJson(response, 200, { url: authorizationUrl(user.id) }); } catch (error) { console.error("Google Drive OAuth config failed", error); return sendJson(response, 503, { error: "O Google Drive ainda não foi configurado no servidor." }); }
};
