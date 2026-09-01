const { authenticateUser, applyRateLimit, hasSafeFetchMetadata, isSameOrigin, rateLimit, requestExceedsLimit, sendJson } = require("./_security");
const { createConnection, deleteConnection, isSafeRemoteUrl, listConnections, setConnectionStatus } = require("./_mcp");

const MAX_BODY = 32 * 1024;
function bodyOf(request) { if (request.body && typeof request.body === "object") return request.body; try { return JSON.parse(request.body || "{}"); } catch { return null; } }
function errorMessage(error) {
  const code = String(error?.message || "");
  if (code === "mcp_remote_request_failed") return "O servidor MCP recusou a conexão.";
  if (code === "mcp_not_found") return "Servidor MCP não encontrado.";
  if (code === "mcp_encryption_not_configured" || code === "supabase_service_role_not_configured") return "O armazenamento seguro de MCP ainda não foi configurado no servidor.";
  if (code === "supabase_unavailable" || code === "mcp_storage_failed") return "Não foi possível acessar o armazenamento seguro agora.";
  return "Não foi possível conectar este servidor MCP.";
}
module.exports = async (request, response) => {
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return sendJson(response, 403, { error: "Origem não permitida." });
  const user = await authenticateUser(request); if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
  const limit = rateLimit(request, "mcp-action", { limit: 20, windowMs: 60000, identity: user.id }); limit.limit = 20; applyRateLimit(response, limit); if (!limit.allowed) return sendJson(response, 429, { error: "Muitas ações de conexão. Aguarde um minuto." });
  if (request.method === "GET") { try { return sendJson(response, 200, { data: await listConnections(user.id) }); } catch (error) { console.error("MCP list failed", error); return sendJson(response, 503, { error: errorMessage(error) }); } }
  if (requestExceedsLimit(request, MAX_BODY)) return sendJson(response, 413, { error: "Configuração grande demais." });
  const body = bodyOf(request);
  try {
    if (request.method === "POST") {
      const name = String(body?.name || "").trim().slice(0, 80);
      const description = String(body?.description || "").trim().slice(0, 180);
      const baseUrl = String(body?.baseUrl || "").trim();
      const token = String(body?.token || "").trim();
      if (!name || name.length < 2) return sendJson(response, 400, { error: "Dê um nome para o servidor MCP." });
      if (!isSafeRemoteUrl(baseUrl)) return sendJson(response, 400, { error: "Use uma URL HTTPS pública do servidor MCP." });
      if (token.length > 4096) return sendJson(response, 400, { error: "O token informado é grande demais." });
      const created = await createConnection(user.id, { name, description, baseUrl, token });
      return sendJson(response, 201, { data: { id: created.id, name: created.name, description: created.description, base_url: created.base_url, status: created.status, tools_count: created.tools_count, created_at: created.created_at, updated_at: created.updated_at } });
    }
    const id = String(body?.id || request.query?.id || "").trim();
    if (!id) return sendJson(response, 400, { error: "Servidor MCP não informado." });
    if (request.method === "PATCH") {
      const status = body?.status === "disconnected" ? "disconnected" : body?.status === "connected" ? "connected" : "";
      if (!status) return sendJson(response, 400, { error: "Status de conexão inválido." });
      const updated = await setConnectionStatus(user.id, id, status);
      return sendJson(response, 200, { data: { id: updated.id, name: updated.name, description: updated.description, base_url: updated.base_url, status: updated.status, tools_count: updated.tools_count, updated_at: updated.updated_at } });
    }
    if (request.method === "DELETE") { await deleteConnection(user.id, id); return sendJson(response, 200, { deleted: true }); }
    response.setHeader("Allow", "GET, POST, PATCH, DELETE"); return sendJson(response, 405, { error: "Método não permitido." });
  } catch (error) {
    console.error("MCP action failed", { message: error?.message, status: error?.status });
    if (error?.status === 401 || error?.status === 403) return sendJson(response, 422, { error: "O servidor MCP exige autorização. Informe um token Bearer válido e tente novamente." });
    return sendJson(response, 422, { error: errorMessage(error) });
  }
};
