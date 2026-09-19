const {
  authenticateUser,
  applyRateLimit,
  hasSafeFetchMetadata,
  isSameOrigin,
  rateLimit,
  sendJson,
} = require("./_security");
const { supabaseRequest } = require("./_kazer-data");

const MAX_PAGE_SIZE = 200;
const CATEGORIES = new Set([
  "preference", "dislike", "personal_context", "project", "goal", "habit",
  "communication_style", "technical_knowledge", "interest", "workflow",
  "instruction", "important_fact", "temporary_context", "relationship_context",
  "learning", "other",
]);

function clientMemory(row) {
  return {
    id: row.id,
    category: row.category,
    group_title: row.group_title || "Outros",
    content: row.content,
    isPinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = async function handler(request, response) {
  if (!["GET", "PATCH", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) {
    return sendJson(response, 403, { error: "Origem não autorizada." });
  }
  const limit = rateLimit(request, "memories", { limit: 60, windowMs: 60_000 });
  limit.limit = 60;
  applyRateLimit(response, limit);
  if (!limit.allowed) return sendJson(response, 429, { error: "Muitas tentativas. Aguarde um momento." });
  const user = await authenticateUser(request);
  if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });

  try {
    if (request.method === "PATCH") {
      const id = String(request.query?.id || "").trim();
      const content = String(request.body?.content || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(id) || content.length < 1 || content.length > 2000) {
        return sendJson(response, 400, { error: "Conteúdo de memória inválido." });
      }
      const rows = await supabaseRequest("kazer_memories", { method: "PATCH", query: { id: `eq.${id}`, user_id: `eq.${user.id}` }, body: { content } });
      return sendJson(response, 200, { memory: Array.isArray(rows) && rows[0] ? clientMemory(rows[0]) : null });
    }
    if (request.method === "DELETE") {
      const id = String(request.query?.id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(response, 400, { error: "Memória inválida." });
      await supabaseRequest("kazer_memories", { method: "DELETE", query: { id: `eq.${id}`, user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { deleted: true });
    }

    const rawLimit = Number(request.query?.limit || 40);
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(rawLimit) ? rawLimit : 40));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    const category = String(request.query?.category || "").trim();
    const query = {
      user_id: `eq.${user.id}`,
      select: "id,category,group_title,content,is_pinned,created_at,updated_at",
      order: "updated_at.desc",
      limit: pageSize,
      offset,
    };
    if (category && CATEGORIES.has(category)) query.category = `eq.${category}`;
    const rows = await supabaseRequest("kazer_memories", { query });
    return sendJson(response, 200, { memories: Array.isArray(rows) ? rows.map(clientMemory) : [], hasMore: Array.isArray(rows) && rows.length === pageSize });
  } catch (error) {
    console.error("Memories API failed", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível carregar as memórias agora." });
  }
};
