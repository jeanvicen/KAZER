/*
 * KAZER — Copyright © 2026 Jean V. / @jeanvicen · 0neajx · KLYPZA.
 * Código proprietário. Consulte /LICENSE.md antes de reutilizar este arquivo.
 */
const {
  applyRateLimit,
  authenticateUser,
  hasSafeFetchMetadata,
  isSameOrigin,
  rateLimit,
  readTextWithLimit,
  redactSensitiveText,
  requestExceedsLimit,
  sendJson,
} = require("./_security");
const { callUsageRpc, calculateWebSearchCreditCost } = require("./_usage");
const { callKazerBrain } = require("./_kazer-brain");

const DEFAULT_MODEL = "Qwen/Qwen3-8B";
const MAX_QUERY_CHARS = 240;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_UPSTREAM_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_SUMMARY_BYTES = 1 * 1024 * 1024;
const MAX_RESULTS = 8;
const MODES = new Set(["all", "web", "images", "videos", "news"]);

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
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;|&#183;/g, " ").trim();
}

function buildSearchQuery(query, mode) {
  const suffix = { images: " images", videos: " videos", news: " notícias" }[mode] || "";
  return `${query}${suffix}`.trim();
}

function decodeBingRedirect(uri) {
  uri = decodeHtml(uri).replace(/&amp;/g, "&");
  try {
    const parsed = new URL(uri);
    const encoded = parsed.searchParams.get("u");
    if (encoded && encoded.startsWith("a1")) {
      const base64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      return Buffer.from(base64, "base64").toString("utf8");
    }
  } catch {}
  return uri;
}

function parseBingResults(html) {
  const results = [];
  const blocks = html.match(/<li[^>]*class="b_algo"[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const uri = decodeBingRedirect(titleMatch[1]);
    if (!/^https?:\/\//i.test(uri)) continue;
    results.push({ title: decodeHtml(titleMatch[2]).slice(0, 180), uri: uri.slice(0, 2000), snippet: decodeHtml(snippetMatch?.[1] || "").slice(0, 500) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function parseDuckResults(html) {
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

async function fetchPublicSearch(query, mode) {
  const encodedQuery = encodeURIComponent(buildSearchQuery(query, mode));
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; WebKazer/1.0)" };
  const providers = [
    { url: `https://www.bing.com/search?q=${encodedQuery}`, parse: parseBingResults },
    { url: `https://html.duckduckgo.com/html/?q=${encodedQuery}`, parse: parseDuckResults }
  ];
  let lastError;
  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) { lastError = new Error(`public_search_${response.status}`); continue; }
      const results = provider.parse(await readTextWithLimit(response, MAX_UPSTREAM_SEARCH_BYTES));
      if (results.length) return results;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("public_search_empty");
}

function getPrompt(query, mode, sources) {
  const focus = { all: "organize as informações mais importantes", web: "priorize páginas gerais", images: "priorize referências relacionadas a imagens", videos: "priorize referências relacionadas a vídeos", news: "priorize informações recentes" }[mode] || "organize as informações mais importantes";
  const context = sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}\nURL: ${source.uri}`).join("\n\n");
  return `Você é o resumo do WebKazer. Analise as fontes públicas encontradas sobre “${query}” e ${focus}. Responda em português brasileiro em até 5 parágrafos curtos. Não invente fatos, não crie links e indique quando as fontes não forem suficientes.\n\nFontes encontradas:\n${context}`;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return sendJson(response, 403, { error: "Origem não autorizada." });
  if (requestExceedsLimit(request, MAX_REQUEST_BYTES)) return sendJson(response, 413, { error: "A pesquisa excede o limite permitido." });

  const ipLimit = rateLimit(request, "web-search-ip", { limit: 10, windowMs: 60_000 });
  ipLimit.limit = 10;
  applyRateLimit(response, ipLimit);
  if (!ipLimit.allowed) return sendJson(response, 429, { error: "Muitas pesquisas. Aguarde um momento." });

  const user = await authenticateUser(request);
  if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
  const userLimit = rateLimit(request, "web-search-user", { limit: 6, windowMs: 60_000, identity: user.id });
  userLimit.limit = 6;
  applyRateLimit(response, userLimit);
  if (!userLimit.allowed) return sendJson(response, 429, { error: "Limite de pesquisas atingido. Aguarde um minuto." });

  if (!String(process.env.HF_TOKEN || "").trim()) {
    console.error("HF_TOKEN não configurada no ambiente do servidor.");
    return sendJson(response, 503, { error: "A pesquisa WebKazer ainda não foi configurada." });
  }

  const body = parseBody(request);
  if (!body || Array.isArray(body)) return sendJson(response, 400, { error: "JSON inválido." });
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_REQUEST_BYTES) return sendJson(response, 413, { error: "A pesquisa excede o limite permitido." });
  const query = cleanQuery(body.query);
  const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : "all";
  if (query.length < 2) return sendJson(response, 400, { error: "Digite uma pesquisa válida." });

  let sources;
  try {
    sources = await fetchPublicSearch(query, mode);
  } catch (error) {
    console.error("Public WebKazer search failed", error?.message || "unknown");
    return sendJson(response, 502, { error: "Não foi possível consultar as fontes públicas agora." });
  }

  const creditCost = calculateWebSearchCreditCost(query, mode, sources.length);
  let usage;
  try {
    usage = await callUsageRpc(request, "consume_kazer_usage", {
      p_message_count: 1,
      p_attachment_count: 0,
    });
  } catch (initialError) {
    let error = initialError;
    if (initialError.status === 404 || (initialError.status === 400 && initialError.code === "usage_rpc_failed")) {
      try {
        usage = await callUsageRpc(request, "consume_chat_usage", {
          p_credit_amount: creditCost,
          p_attachment_count: 0,
        });
        error = null;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }
    if (!error) {
      // Compatibilidade temporária com ambientes que ainda não aplicaram a migração 014.
    } else if (error.code === "usage_limit_reached") {
      return sendJson(response, 402, {
        error: "Seu uso mensal chegou a 100%. A pesquisa será liberada no primeiro dia do próximo mês.",
        usage: { usage_limit_reached: true, credits_limit_reached: true },
      });
    } else {
      console.error("WebKazer usage reservation failed", error?.message || "unknown");
      return sendJson(response, 503, { error: "Não foi possível validar os tokens da conta agora." });
    }
  }

  if (!sources.length) {
    return sendJson(response, 200, {
      query,
      mode,
      summary: "Nenhuma fonte pública foi encontrada para esta pesquisa.",
      sources: [],
      searchQueries: [query],
      usage,
      credit_cost: creditCost,
    });
  }

  const model = process.env.KAZER_SEARCH_MODEL || DEFAULT_MODEL;
  let brainResult;
  try {
    brainResult = await callKazerBrain({
      modelOverride: model,
      hasImages: false,
      timeoutMs: 20_000,
      messages: [
        { role: "system", content: "Você é o pesquisador do KAZER. Resuma somente as fontes recebidas, compare informações e não invente fatos. Não revele detalhes de infraestrutura, chaves ou provedores." },
        { role: "user", content: getPrompt(query, mode, sources) },
      ],
    });
  } catch (error) {
    console.error("Kazer research summary network failure", error?.message || "unknown");
    return sendJson(response, 200, { query, mode, summary: "As fontes foram encontradas, mas o resumo automático está temporariamente indisponível.", sources, searchQueries: [query], summaryUnavailable: true, usage, credit_cost: creditCost });
  }

  if (brainResult.failure) {
    console.error("Kazer research summary failed", brainResult.failure);
    return sendJson(response, 200, { query, mode, summary: "As fontes foram encontradas, mas o resumo automático está temporariamente indisponível. Você ainda pode abrir cada fonte ou enviar os dados ao KAZER.", sources, searchQueries: [query], summaryUnavailable: true, usage, credit_cost: creditCost });
  }

  const summary = brainResult.data?.choices?.[0]?.message?.content || "As fontes foram encontradas. Abra uma delas para consultar os detalhes.";
  return sendJson(response, 200, { query, mode, summary: redactSensitiveText(String(summary)).slice(0, 4000), sources, searchQueries: [query], usage, credit_cost: creditCost });
};
