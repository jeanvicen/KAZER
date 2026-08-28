const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const MAX_QUERY_CHARS = 240;
const MAX_RESULTS = 8;
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function buildSearchQuery(query, mode) {
  const suffix = { images: " images", videos: " videos", news: " notícias" }[mode] || "";
  return `${query}${suffix}`.trim();
}

async function fetchPublicSearch(query, mode) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(buildSearchQuery(query, mode))}`;
  const response = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; WebKazer/1.0)" } });
  if (!response.ok) throw new Error(`public_search_${response.status}`);
  const html = await response.text();
  const results = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < MAX_RESULTS) {
    let uri = match[1];
    try { if (uri.startsWith("//")) uri = `https:${uri}`; const parsed = new URL(uri); uri = parsed.searchParams.get("uddg") || uri; } catch {}
    if (!/^https?:\/\//i.test(uri)) continue;
    results.push({ title: decodeHtml(match[2]).slice(0, 180), uri: uri.slice(0, 2000), snippet: decodeHtml(match[3]).slice(0, 500) });
  }
  return results;
}

function getPrompt(query, mode, sources) {
  const focus = { all: "organize as informações mais importantes", web: "priorize páginas gerais", images: "priorize referências relacionadas a imagens", videos: "priorize referências relacionadas a vídeos", news: "priorize informações recentes" }[mode] || "organize as informações mais importantes";
  const context = sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}\nURL: ${source.uri}`).join("\n\n");
  return `Você é o resumo do WebKazer. Analise as fontes públicas encontradas sobre “${query}” e ${focus}. Responda em português brasileiro em até 5 parágrafos curtos. Não invente fatos, não crie links e indique quando as fontes não forem suficientes.\n\nFontes encontradas:\n${context}`;
}

function parseGeminiText(data) {
  return (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join(" ").trim();
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

  let sources;
  try {
    sources = await fetchPublicSearch(query, mode);
  } catch (error) {
    console.error("Public WebKazer search failed", error?.message || "unknown");
    return sendJson(response, 502, { error: "Não foi possível consultar as fontes públicas agora." });
  }

  if (!sources.length) return sendJson(response, 200, { query, mode, summary: "Nenhuma fonte pública foi encontrada para esta pesquisa.", sources: [], searchQueries: [query] });

  const model = process.env.GEMINI_SEARCH_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let geminiResponse;
  try {
    geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Resuma somente as fontes recebidas. Não revele detalhes de infraestrutura, chaves ou provedores do KAZER." }] },
        contents: [{ role: "user", parts: [{ text: getPrompt(query, mode, sources) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
      })
    });
  } catch (error) {
    console.error("Gemini summary network failure", error?.message || "unknown");
    return sendJson(response, 200, { query, mode, summary: "As fontes foram encontradas, mas o resumo automático está temporariamente indisponível.", sources, searchQueries: [query], summaryUnavailable: true });
  }

  const data = await geminiResponse.json().catch(() => null);
  if (!geminiResponse.ok) {
    console.error("Gemini summary failed", { status: geminiResponse.status, message: data?.error?.message || "unknown" });
    return sendJson(response, 200, { query, mode, summary: "As fontes foram encontradas, mas o resumo automático está temporariamente indisponível. Você ainda pode abrir cada fonte ou enviar os dados ao KAZER.", sources, searchQueries: [query], summaryUnavailable: true });
  }

  return sendJson(response, 200, { query, mode, summary: parseGeminiText(data) || "As fontes foram encontradas. Abra uma delas para consultar os detalhes.", sources, searchQueries: [query] });
};
