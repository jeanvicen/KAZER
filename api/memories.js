const {
  authenticateUser,
  applyRateLimit,
  hasSafeFetchMetadata,
  isSameOrigin,
  rateLimit,
  sendJson,
} = require("./_security");
const { supabaseRequest } = require("./_kazer-data");

function safeLearningUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function readablePageText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

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
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
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
    if (request.method === "POST") {
      const url = safeLearningUrl(request.body?.url);
      if (!url) return sendJson(response, 400, { error: "URL não permitida." });
      const page = await fetch(url, { headers: { Accept: "text/html,text/plain", "User-Agent": "KAZER-Learning/1.0" }, signal: AbortSignal.timeout(10_000) });
      if (!page.ok) return sendJson(response, 422, { error: "Não foi possível ler esse link." });
      const text = readablePageText(await page.text());
      if (text.length < 40) return sendJson(response, 422, { error: "Esse link não tem conteúdo legível." });
      const title = url.hostname.replace(/^www\./, "");
      const content = `Fonte: ${url.href}\nConteúdo aprendido de ${title}: ${text}`.slice(0, 16000);
      const rows = await supabaseRequest("kazer_memories", { method: "POST", body: { user_id: user.id, category: "learning", group_title: "Habilidades e ensinamentos", content, importance: 0.8, confidence: 0.75, source: url.href, is_pinned: false } });
      return sendJson(response, 201, { memory: Array.isArray(rows) && rows[0] ? clientMemory(rows[0]) : null });
    }
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
