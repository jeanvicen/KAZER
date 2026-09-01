const { getConnection } = require("./_github");
const { requireUser, supabaseRequest, unauthorized } = require("./_kazer-data");
const { sendJson } = require("./_security");

module.exports = async function handler(request, response) {
  if (request.method !== "DELETE") {
    response.setHeader("Allow", "DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  try {
    await supabaseRequest("kazer_github_connections", { method: "DELETE", query: { user_id: `eq.${user.id}` } });
    return sendJson(response, 200, { success: true, connection: { connected: false } });
  } catch (error) {
    console.error("GitHub disconnect failed", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível desconectar o GitHub." });
  }
};
