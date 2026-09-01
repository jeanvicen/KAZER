const { getConnection, connectionForClient } = require("./_github");
const { requireUser, supabaseRequest, unauthorized } = require("./_kazer-data");
const { sendJson } = require("./_security");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  try {
    const row = await getConnection(user.id);
    return sendJson(response, 200, { connection: connectionForClient(row) });
  } catch (error) {
    console.error("GitHub status failed", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível verificar a conexão GitHub." });
  }
};
