const { getSearchQueryVariants, normalizeSearchQuery, parseBingResults, parseBingRssResults, parseDuckResults, rankAndDedupeResults, safeSearchResultUrl } = require("./_research-search-utils");
const { ResearchBrowser, cleanText } = require("./_research-browser");

const DEFAULT_BUDGETS = {
  normal: { searches: 4, pages: 8, actions: 16 },
  deep: { searches: 12, pages: 18, actions: 48 },
};
const SEARCH_BYTES = 1_500_000;
const DEEP_FACETS = [
  "latest news updates",
  "official sources confirmed facts",
  "timeline history",
  "expert analysis",
  "statistics data report",
  "opinions criticism controversy",
  "frequently asked questions",
  "comparison alternatives",
  "technical details explanation",
  "risks limitations impact",
  "portuguese brazil news",
];

async function fetchText(url, timeoutMs = 8_000) {
  const response = await fetch(url, { headers: { Accept: "text/html,application/xhtml+xml,application/xml", "User-Agent": "KAZER-Research/2.0" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (!response.ok) throw new Error(`search_provider_${response.status}`);
  if (Buffer.byteLength(body, "utf8") > SEARCH_BYTES) throw new Error("search_provider_too_large");
  return body;
}

async function fetchSearchProvider(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await fetchText(url, 8_000); }
    catch (error) { lastError = error; if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 220)); }
  }
  throw lastError || new Error("search_provider_failed");
}

async function searchWeb(query, mode = "web") {
  const encoded = encodeURIComponent(query);
  const providers = [
    { url: `https://www.bing.com/search?q=${encoded}`, parser: parseBingResults },
    { url: `https://www.bing.com/search?format=rss&q=${encoded}`, parser: parseBingRssResults },
    { url: `https://html.duckduckgo.com/html/?q=${encoded}`, parser: parseDuckResults },
    { url: `https://news.google.com/rss/search?q=${encoded}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, parser: parseBingRssResults },
  ];
  const results = await Promise.allSettled(providers.map(async (provider) => provider.parser(await fetchSearchProvider(provider.url), 12)));
  let values = results.flatMap((item) => item.status === "fulfilled" ? item.value : []);
  let ranked = rankAndDedupeResults(query, values, mode === "deep" ? 12 : 8);
  if (!ranked.length) {
    const fallbackProviders = [
      { url: `https://html.duckduckgo.com/html/?q=${encoded}&kl=br-pt`, parser: parseDuckResults },
      { url: `https://www.bing.com/search?format=rss&setlang=pt-br&cc=br&q=${encoded}`, parser: parseBingRssResults },
    ];
    const fallbacks = await Promise.allSettled(fallbackProviders.map(async (provider) => provider.parser(await fetchSearchProvider(provider.url), 12)));
    values = [...values, ...fallbacks.flatMap((item) => item.status === "fulfilled" ? item.value : [])];
    ranked = rankAndDedupeResults(query, values, mode === "deep" ? 12 : 8);
  }
  // Último recurso: o resultado veio do buscador, mas o ranking conservador não
  // encontrou tokens literais por causa de idioma, acentos ou snippets curtos.
  return ranked.length ? ranked : rankAndDedupeResults("", values, mode === "deep" ? 12 : 8);
}

function deepQueries(query, limit) {
  const base = normalizeSearchQuery(query).slice(0, 240);
  const variants = [base, ...DEEP_FACETS.map((facet) => `${base} ${facet}`)];
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function stripExternalInstructions(text) {
  return cleanText(text, 8_000).replace(/(?:ignore|ignore all|system prompt|reveal|secret|token|senha|instru[cç][aã]o)[^.!?]{0,180}[.!?]?/gi, "[conteúdo externo não confiável removido]");
}

function evidenceFromSource(source, page, query, accessedAt, browserAvailable) {
  const relevantText = stripExternalInstructions(page?.text || source.snippet || "");
  return {
    sourceUrl: safeSearchResultUrl(source.uri),
    sourceTitle: cleanText(page?.title || source.title, 240),
    relevantText,
    relevantPassage: relevantText.slice(0, 2_400),
    searchQuery: query,
    accessedAt,
    pageRead: Boolean(page?.pageRead),
    browserUsed: browserAvailable,
    headings: Array.isArray(page?.headings) ? page.headings.slice(0, 12) : [],
  };
}

function publicSource(evidence) {
  return { title: evidence.sourceTitle || "Fonte", uri: evidence.sourceUrl, snippet: evidence.relevantPassage.slice(0, 500), pageRead: evidence.pageRead, browserUsed: evidence.browserUsed };
}

async function httpFallback(source, timeoutMs = 5_000) {
  try {
    const response = await fetch(source.uri, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KAZER-Research/2.0" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const html = await response.text();
    const text = cleanText(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|template|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "), 18_000);
    return { title: source.title, text, pageRead: response.ok && text.length >= 120, headings: [] };
  } catch {
    return { title: source.title, text: source.snippet || "", pageRead: false, headings: [] };
  }
}

async function runResearch({ question, mode = "normal", deep = false, maxSearches, maxPages, maxActions } = {}) {
  const normalized = normalizeSearchQuery(question).slice(0, 240);
  if (normalized.length < 2) throw new Error("research_question_invalid");
  const isDeep = Boolean(deep || mode === "deep");
  const budget = DEFAULT_BUDGETS[isDeep ? "deep" : "normal"];
  const limits = {
    searches: Math.min(budget.searches, Math.max(1, Number(maxSearches) || budget.searches)),
    pages: Math.min(budget.pages, Math.max(1, Number(maxPages) || budget.pages)),
    actions: Math.min(budget.actions, Math.max(4, Number(maxActions) || budget.actions)),
  };
  const state = { question: cleanText(question, 600), queries: [], visitedUrls: [], actions: [], evidence: [], errors: [], browserAvailable: false, limits, candidateCount: 0, stopReason: "budget" };
  const browser = new ResearchBrowser({ maxActions: limits.actions });
  const started = await browser.start();
  state.browserAvailable = started.available;
  if (!started.available) state.errors.push(`browser_unavailable:${started.reason || "unknown"}`);
  try {
    const variants = isDeep ? deepQueries(normalized, limits.searches) : getSearchQueryVariants(normalized, "web").slice(0, limits.searches);
    state.queries = variants;
    variants.forEach((query) => state.actions.push({ type: "search", query, at: new Date().toISOString() }));
    const batches = await Promise.allSettled(variants.map((query) => searchWeb(query, isDeep ? "deep" : "web")));
    const rawSources = batches.flatMap((item) => item.status === "fulfilled" ? item.value : []);
    batches.forEach((item) => { if (item.status === "rejected") state.errors.push(String(item.reason?.message || "search_failed").slice(0, 240)); });
    const sourcePool = rankAndDedupeResults(normalized, rawSources, isDeep ? 120 : 12);
    state.candidateCount = sourcePool.length;
    // A descoberta já é uma fonte útil. Não esconda os resultados só porque
    // uma página bloqueou o crawler ou excedeu o timeout serverless.
    state.sources = sourcePool.map((source) => ({ title: source.title, uri: source.uri, snippet: source.snippet, pageRead: false, browserUsed: false }));
    const selected = sourcePool.slice(0, limits.pages);
    state.visitedUrls = selected.map((source) => source.uri);

    if (state.browserAvailable) {
      for (const source of selected) {
        if (state.evidence.length >= limits.pages) break;
        const accessedAt = new Date().toISOString();
        let page;
        try { page = await browser.open(source.uri); state.actions.push({ type: "browser_open", url: source.uri, at: accessedAt }); }
        catch (error) { state.errors.push(String(error?.message || "browser_open_failed").slice(0, 240)); }
        if (!page) { page = await httpFallback(source); state.actions.push({ type: "http_fallback", url: source.uri, at: accessedAt }); }
        if (page?.pageRead || page?.text) state.evidence.push(evidenceFromSource(source, page, sourcePool.length ? normalized : source.title, accessedAt, state.browserAvailable && page.pageRead));
      }
    } else {
      const pages = await Promise.all(selected.map(async (source) => ({ source, page: await httpFallback(source), accessedAt: new Date().toISOString() })));
      pages.forEach(({ source, page, accessedAt }) => {
        state.actions.push({ type: "http_fallback", url: source.uri, at: accessedAt });
        if (page?.pageRead || page?.text) state.evidence.push(evidenceFromSource(source, page, normalized, accessedAt, false));
      });
    }
    if (!state.evidence.length && sourcePool.length) {
      selected.forEach((source) => state.evidence.push(evidenceFromSource(source, { title: source.title, text: source.snippet, pageRead: false, headings: [] }, normalized, new Date().toISOString(), false)));
    }
    if (!state.evidence.length) state.stopReason = "no_evidence";
    else if (state.candidateCount >= 100) state.stopReason = "deep_source_pool_complete";
    else if (state.evidence.length >= limits.pages) state.stopReason = "page_limit";
    else state.stopReason = "sufficient_evidence";
  } finally {
    await browser.close();
  }
  return { ...state, sources: state.sources || state.evidence.map(publicSource), evidence: state.evidence.slice(0, limits.pages) };
}

const researchToolDefinition = { type: "function", function: { name: "research_web", description: "Pesquisa profundamente na Internet: cria várias consultas, coleta até 120 candidatos, abre páginas públicas, cruza evidências e retorna apenas dados para uma síntese final. Use para fatos atuais, pesquisa explícita, comparação ou quando fontes externas forem necessárias; o processo deve permanecer invisível ao usuário.", parameters: { type: "object", properties: { question: { type: "string", description: "Pergunta ou objetivo da pesquisa" }, depth: { type: "string", enum: ["normal", "deep"] } }, required: ["question"] } } };

module.exports = { DEFAULT_BUDGETS, researchToolDefinition, runResearch, searchWeb, deepQueries };
