const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_QUERY_CHARS = 240;
const MODES = new Set(["all", "web", "images", "videos", "news"]);

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestHost = (request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
    return Boolean(requestHost) && originUrl.host === requestHost;
  } catch {
    return false;
  }
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

function cleanQuery(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

function getPrompt(query, mode) {
  const focus = {
    all: "Encontre contexto geral e fontes úteis. Quando fizer sentido, inclua páginas, imagens, vídeos e notícias relacionadas.",
    web: "Priorize páginas e fontes gerais da web.",
    images: "Priorize páginas que contenham imagens relevantes e descreva brevemente o que cada fonte oferece; não invente URLs de imagens.",
    videos: "Priorize vídeos e páginas de vídeo relevantes; não invente vídeos nem URLs.",
    news: "Priorize notícias recentes e indique a data quando a fonte informar."
  }[mode] || "Encontre contexto geral e fontes úteis.";
  return `Pesquise na web em tempo real sobre: ${query}\n\n${focus}\n\nResponda em português brasileiro com um resumo objetivo, deixando claro quando algo não puder ser confirmado. Não invente fatos, títulos ou links. As fontes verificáveis serão exibidas separadamente pela aplicação.`;
}

function parseGroundedResponse(data) {
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((part) => part?.text || "").join(" ").trim();
  const metadata = candidate?.groundingMetadata || {};
  const sources = [];
  const seen = new Set();
  for (const chunk of metadata.groundingChunks || []) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: String(title).slice(0, 180), uri: String(uri).slice(0, 2000) });
  }
  return {
    summary: text,
    sources: sources.slice(0, 12),
    searchQueries: (metadata.webSearchQueries || []).map((item) => String(item).slice(0, 240)).slice(0, 8)
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Origem não autorizada." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY não configurada no ambiente do servidor.");
    return sendJson(response, 503, { error: "A pesquisa WebKazer ainda não foi configurada." });
  }

  const body = parseBody(request);
  if (!body) return sendJson(response, 400, { error: "JSON inválido." });
  const query = cleanQuery(body.query);
  const mode = MODES.has(body.mode) ? body.mode : "all";
  if (query.length < 2) return sendJson(response, 400, { error: "Digite uma pesquisa válida." });

  const model = process.env.GEMINI_SEARCH_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let geminiResponse;
  try {
    geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Você é o mecanismo de pesquisa do WebKazer. Use somente informações fundamentadas nas buscas atuais. Nunca invente fontes." }] },
        contents: [{ role: "user", parts: [{ text: getPrompt(query, mode) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
      })
    });
  } catch (error) {
    console.error("Gemini search network failure", error?.message || "unknown");
    return sendJson(response, 502, { error: "Não foi possível consultar a pesquisa agora." });
  }

  const data = await geminiResponse.json().catch(() => null);
  if (!geminiResponse.ok) {
    console.error("Gemini search failed", { status: geminiResponse.status, message: data?.error?.message || "unknown" });
    return sendJson(response, 502, { error: "A pesquisa não pôde ser concluída agora. Tente novamente." });
  }

  const result = parseGroundedResponse(data);
  if (!result.summary && result.sources.length === 0) return sendJson(response, 502, { error: "A pesquisa não retornou resultados verificáveis." });
  return sendJson(response, 200, { query, mode, ...result });
};
