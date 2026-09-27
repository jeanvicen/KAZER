const { getSearchQueryVariants, normalizeSearchQuery, parseBingResults, parseBingRssResults, parseDuckResults, rankAndDedupeResults, safeSearchResultUrl } = require("./_research-search-utils");
const { ResearchBrowser, cleanText } = require("./_research-browser");

const DEFAULT_BUDGETS = { normal: { searches: 3, pages: 8, actions: 12 }, deep: { searches: 6, pages: 15, actions: 25 } };
const SEARCH_BYTES = 1_500_000;

async function fetchText(url, timeoutMs = 8_000) {
  const response = await fetch(url, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KAZER-Research/1.0" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (!response.ok) throw new Error(`search_provider_${response.status}`);
  if (Buffer.byteLength(body, "utf8") > SEARCH_BYTES) throw new Error("search_provider_too_large");
  return body;
}

async function searchWeb(query, mode = "web") {
  const encoded = encodeURIComponent(query);
  const providers = [
    { url: `https://www.bing.com/search?q=${encoded}`, parser: parseBingResults },
    { url: `https://www.bing.com/search?format=rss&q=${encoded}`, parser: parseBingRssResults },
    { url: `https://html.duckduckgo.com/html/?q=${encoded}`, parser: parseDuckResults },
  ];
  const results = await Promise.allSettled(providers.map(async (provider) => provider.parser(await fetchText(provider.url), 8)));
  const values = results.flatMap((item) => item.status === "fulfilled" ? item.value : []);
  return rankAndDedupeResults(query, values, mode === "news" ? 8 : 8);
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

function publicSource(evidence) { return { title: evidence.sourceTitle || "Fonte", uri: evidence.sourceUrl, snippet: evidence.relevantPassage.slice(0, 500), pageRead: evidence.pageRead, browserUsed: evidence.browserUsed }; }

async function httpFallback(source) {
  try {
    const response = await fetch(source.uri, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KAZER-Research/1.0" }, redirect: "error", signal: AbortSignal.timeout(8_000) });
    const html = await response.text();
    const text = cleanText(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|template|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "), 18_000);
    return { title: source.title, text, pageRead: response.ok && text.length >= 120, headings: [] };
  } catch { return { title: source.title, text: source.snippet || "", pageRead: false, headings: [] }; }
}

async function runResearch({ question, mode = "normal", deep = false, maxSearches, maxPages, maxActions } = {}) {
  const normalized = normalizeSearchQuery(question).slice(0, 240);
  if (normalized.length < 2) throw new Error("research_question_invalid");
  const budget = DEFAULT_BUDGETS[deep || mode === "deep" ? "deep" : "normal"];
  const limits = { searches: Math.min(budget.searches, Number(maxSearches) || budget.searches), pages: Math.min(budget.pages, Number(maxPages) || budget.pages), actions: Math.min(budget.actions, Number(maxActions) || budget.actions) };
  const state = { question: cleanText(question, 600), queries: [], visitedUrls: [], actions: [], evidence: [], errors: [], browserAvailable: false, limits, stopReason: "budget" };
  const browser = new ResearchBrowser({ maxActions: limits.actions });
  const started = await browser.start();
  state.browserAvailable = started.available;
  if (!started.available) state.errors.push(`browser_unavailable:${started.reason || "unknown"}`);
  try {
    const variants = getSearchQueryVariants(normalized, "web").slice(0, limits.searches);
    for (const query of variants) {
      if (state.queries.length >= limits.searches || state.evidence.length >= limits.pages) break;
      state.queries.push(query);
      state.actions.push({ type: "search", query, at: new Date().toISOString() });
      let sources = [];
      try { sources = await searchWeb(query, "web"); } catch (error) { state.errors.push(String(error?.message || "search_failed")); continue; }
      for (const source of sources) {
        if (state.evidence.length >= limits.pages) break;
        if (!source?.uri || state.visitedUrls.includes(source.uri)) continue;
        state.visitedUrls.push(source.uri);
        const accessedAt = new Date().toISOString();
        let page;
        if (state.browserAvailable) {
          try { page = await browser.open(source.uri); state.actions.push({ type: "browser_open", url: source.uri, at: accessedAt }); }
          catch (error) { state.errors.push(String(error?.message || "browser_open_failed")); }
        }
        if (!page) { page = await httpFallback(source); state.actions.push({ type: "http_fallback", url: source.uri, at: accessedAt }); }
        if (page?.pageRead || page?.text) state.evidence.push(evidenceFromSource(source, page, query, accessedAt, state.browserAvailable && page.pageRead));
      }
      if (state.evidence.length >= 2 && !deep) break;
    }
    if (!state.evidence.length) state.stopReason = "no_evidence";
    else if (state.queries.length >= limits.searches) state.stopReason = "search_limit";
    else if (state.evidence.length >= limits.pages) state.stopReason = "page_limit";
    else state.stopReason = "sufficient_evidence";
  } finally { await browser.close(); }
  return { ...state, sources: state.evidence.map(publicSource), evidence: state.evidence.slice(0, limits.pages) };
}

const researchToolDefinition = { type: "function", function: { name: "research_web", description: "Investiga uma pergunta na Internet com buscas, abertura real de páginas JavaScript quando disponível, extração de evidências e fontes verificáveis. Use para fatos atuais, pedidos explícitos de pesquisa, comparação ou quando o conhecimento interno não basta; não use para conversa simples.", parameters: { type: "object", properties: { question: { type: "string", description: "Pergunta ou objetivo da pesquisa" }, depth: { type: "string", enum: ["normal", "deep"] } }, required: ["question"] } } };

module.exports = { DEFAULT_BUDGETS, researchToolDefinition, runResearch, searchWeb };
