const { isPublicAddress, isSafePublicHostname } = require("../security/_network-address");

const SEARCH_STOP_WORDS = new Set((
  "a ao aos as o os de da das do dos em no nos na nas por para com sem sobre e ou um uma uns umas que qual quais quem quando onde como quanto quantos quantas me meu minha seus suas seu sua voce vc pode poderia gostaria quero queria preciso pesquisar pesquisa busque buscar procura procurar encontre encontrar hoje agora atualmente atual recente recentes mais melhor melhores isso aquilo esta estao eh the a an and are as at be by for from how in into is it of on or that this to with what when where which who why will today current latest"
).split(/\s+/));
const LOCATION_MODIFIERS = new Set("aberto aberta abertos abertas fechado fechada fechados fechadas agora hoje amanha ontem perto nearby open closed available melhor melhores barato baratos barata baratas economico economica atual atualizada atualizados recente recentes mim aqui downtown centro cidade bairro luxo luxury praia montanha campo business family casal".split(/\s+/));
const LOCAL_SEARCH_GROUPS = [
  { key: "hotel", terms: ["hotel", "hoteis", "hotels", "pousada", "pousadas", "hospedagem", "hospedagens", "alojamento", "alojamentos", "motel", "motels", "resort", "resorts"], searchTerm: "hotel", searchHint: "pousada hospedagem reservas", synonyms: ["hotel", "pousada", "hospedagem", "alojamento", "motel", "resort", "lodging", "accommodation", "inn"] },
  { key: "restaurant", terms: ["restaurante", "restaurantes", "restaurant", "restaurants", "lanchonete", "lanchonetes", "pizzaria", "pizzarias", "cafeteria", "cafeterias"], searchTerm: "restaurante", searchHint: "endereco cardapio", synonyms: ["restaurante", "lanchonete", "pizzaria", "cafeteria", "restaurant", "eatery"] },
  { key: "pharmacy", terms: ["farmacia", "farmacias", "pharmacy", "pharmacies", "drogaria", "drogarias"], searchTerm: "farmacia", searchHint: "endereco telefone", synonyms: ["farmacia", "drogaria", "pharmacy"] },
  { key: "healthcare", terms: ["hospital", "hospitais", "clinica", "clinicas", "medico", "medicos", "dentista", "dentistas"], searchTerm: "clinica", searchHint: "endereco telefone", synonyms: ["hospital", "clinica", "medico", "dentista"] },
  { key: "retail", terms: ["loja", "lojas", "mercado", "mercados", "supermercado", "supermercados", "store", "stores"], searchTerm: "loja", searchHint: "endereco telefone", synonyms: ["loja", "mercado", "supermercado", "store", "shop"] },
];

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;|&#183;|&ndash;|&mdash;/gi, " ")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code) => {
      const point = parseInt(code, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchQuery(value) {
  const original = cleanText(value).slice(0, 500);
  const query = original
    .replace(/^(?:por favor[,;:]?\s*)?(?:(?:voce|vc)\s+)?(?:(?:pode|poderia|consegue)\s+)?(?:(?:me\s+)?(?:pesquise|pesquisar|pesquisa|busque|buscar|busca|procure|procurar|investigue|investigar|encontre|encontrar|ache|achar|localize|localizar)\s+)/i, "")
    .replace(/^(?:por favor[,;:]?\s*)?(?:me\s+)?(?:diz|diga|fala|fale|mostra|mostre|informe|conta|conte)\s+(?:(?:qual|quais|quem|quanto|quando|onde|como)\s+)?/i, "")
    .replace(/^(?:sobre\s+|a respeito de\s+)/i, "")
    .replace(/^(?:(?:na|no|pela|pelo)\s+)?(?:web|internet|google)\s+/i, "")
    .replace(/^(?:google\s+search\s+)/i, "")
    .replace(/^(?:quanto (?:est[aá]|custa|vale)\s+|qual [eé] (?:o )?(?:pre[cç]o|valor|cota[cç][aã]o) (?:de|do|da)\s+)/i, "")
    .replace(/^(?:(?:e|é)\s+)?(?:o\s+)?(?:pre[cç]o|valor|cota[cç][aã]o)\s+(?:do|da|de)\s+/i, "")
    .replace(/^(?:o|a)\s+(?=(?:d[oó]lar|euro|bitcoin|ethereum|tempo|clima|previs[aã]o)\b)/i, "")
    .replace(/[?!.;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (query || original).slice(0, 240);
}

function buildSearchQuery(query, mode = "all") {
  const suffix = { images: " imagens", videos: " vídeos", news: " notícias" }[mode] || "";
  return `${normalizeSearchQuery(query)}${suffix}`.trim();
}

function safeSearchResultUrl(value) {
  try {
    const url = new URL(cleanText(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (!isSafePublicHostname(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function decodeBingRedirect(value) {
  const uri = cleanText(value).replace(/&amp;/g, "&");
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

function getAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'") : "";
}

function classHas(attributes, className) {
  const value = getAttribute(attributes, "class");
  return value.split(/\s+/).includes(className);
}

function parseBingResults(html, maximum = 8) {
  const results = [];
  const blocks = String(html || "").match(/<li\b(?=[^>]*\bclass\s*=\s*[\"'][^\"']*\bb_algo\b)[^>]*>[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const titleMatch = block.match(/<h2\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const rawHref = getAttribute(titleMatch[1], "href");
    const uri = safeSearchResultUrl(decodeBingRedirect(rawHref));
    if (!uri) continue;
    const snippetMatch = block.match(/<(?:p|div)\b[^>]*class\s*=\s*[\"'][^\"']*(?:b_caption|b_snippet)[^\"']*[\"'][^>]*>([\s\S]*?)<\/(?:p|div)>/i)
      || block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const title = cleanText(titleMatch[2]).slice(0, 180);
    if (!title) continue;
    results.push({ title, uri: uri.slice(0, 2000), snippet: cleanText(snippetMatch?.[1] || "").slice(0, 500) });
    if (results.length >= maximum) break;
  }
  return results;
}

function parseDuckResults(html, maximum = 8) {
  const source = String(html || "");
  const anchors = [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const titles = anchors.filter((match) => classHas(match[1], "result__a"));
  const results = [];
  for (let index = 0; index < titles.length && results.length < maximum; index += 1) {
    const titleMatch = titles[index];
    const start = titleMatch.index + titleMatch[0].length;
    const end = titles[index + 1]?.index ?? Math.min(source.length, start + 2400);
    const snippetMatch = source.slice(start, end).match(/<(?:a|div|span)\b([^>]*)>([\s\S]*?)<\/(?:a|div|span)>/gi)?.map((tag) => {
      const attributes = tag.match(/^<(?:a|div|span)\b([^>]*)>/i)?.[1] || "";
      return classHas(attributes, "result__snippet") ? tag.replace(/^<[\s\S]*?>|<\/[^>]+>$/g, "") : null;
    }).find(Boolean);
    let uri = getAttribute(titleMatch[1], "href");
    try {
      if (uri.startsWith("//")) uri = `https:${uri}`;
      const parsed = new URL(cleanText(uri));
      uri = parsed.searchParams.get("uddg") || parsed.href;
    } catch {}
    uri = safeSearchResultUrl(uri);
    const title = cleanText(titleMatch[2]).slice(0, 180);
    if (!uri || !title) continue;
    results.push({ title, uri: uri.slice(0, 2000), snippet: cleanText(snippetMatch || "").slice(0, 500) });
  }
  return results;
}

function parseBingRssResults(xml, maximum = 8) {
  const source = String(xml || "");
  const items = source.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const results = [];
  for (const item of items) {
    const titleMatch = item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const descriptionMatch = item.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const title = cleanText(titleMatch?.[1] || "").slice(0, 180);
    const uri = safeSearchResultUrl(cleanText(linkMatch?.[1] || ""));
    if (!title || !uri) continue;
    results.push({ title, uri: uri.slice(0, 2000), snippet: cleanText(descriptionMatch?.[1] || "").slice(0, 500) });
    if (results.length >= maximum) break;
  }
  return results;
}

function canonicalSearchUrl(value) {
  const uri = safeSearchResultUrl(value);
  if (!uri) return "";
  try {
    const url = new URL(uri);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|dclid|fbclid|mc_cid|mc_eid|ref|ref_src|source|campaign|_ga)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    const host = url.host.toLowerCase().replace(/^www\./, "");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const params = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    url.search = "";
    for (const [key, value] of params) url.searchParams.append(key, value);
    return `${host}${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

function foldSearchText(value) {
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeSearchToken(value) {
  const token = String(value || "");
  const equivalents = {
    hoteis: "hotel", hotels: "hotel", motels: "motel", resorts: "resort",
    pousadas: "pousada", hospedagens: "hospedagem", alojamentos: "alojamento",
    restaurantes: "restaurante", restaurants: "restaurant", lanchonetes: "lanchonete",
    pizzarias: "pizzaria", cafeterias: "cafeteria", farmacias: "farmacia",
    pharmacies: "pharmacy", drogarias: "drogaria", clinicas: "clinica",
    hospitais: "hospital", medicos: "medico", dentistas: "dentista",
    mercados: "mercado", supermercados: "supermercado", lojas: "loja", stores: "store",
  };
  return equivalents[token] || token;
}

function searchTokens(value) {
  return foldSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token))
    .map(normalizeSearchToken);
}

function getLocalSearchContext(query) {
  const original = cleanText(query);
  const folded = foldSearchText(original);
  const category = LOCAL_SEARCH_GROUPS.find((group) => group.terms.some((term) => new RegExp(`\\b${term}\\b`).test(folded)));
  if (!category) return null;

  const separators = [...original.matchAll(/\b(?:perto\s+de|em|no|na|de|do|da|para|in|near)\s+/giu)];
  let locationText = "";
  if (separators.length) {
    const separator = separators[separators.length - 1];
    locationText = original.slice(separator.index + separator[0].length);
    locationText = locationText.split(/[?!.;,]/, 1)[0]
      .replace(/\b(?:abertos?|abertas?|fechados?|fechadas?|open|closed|available|agora|hoje|amanha|ontem|perto|near)\b.*$/iu, "")
      .trim();
    if (/^(?:de|do|da|para)\s/i.test(separator[0]) && !/^\p{Lu}/u.test(locationText)) locationText = "";
  }

  const categoryTokens = new Set(category.terms.flatMap((term) => searchTokens(term)));
  const queryTokens = [...new Set(searchTokens(original))];
  const locationTokens = (searchTokens(locationText).length
    ? searchTokens(locationText)
    : queryTokens.filter((token) => !categoryTokens.has(token) && !LOCATION_MODIFIERS.has(token)))
    .filter((token) => !LOCATION_MODIFIERS.has(token))
    .slice(0, 3);
  return { ...category, locationText: locationText || locationTokens.join(" "), locationTokens };
}

function getSearchQueryVariants(query, mode = "all") {
  const base = buildSearchQuery(query, mode);
  const local = getLocalSearchContext(normalizeSearchQuery(query));
  if (!local?.locationText || !local.locationTokens.length) return [base];
  const suffix = { images: " imagens", videos: " vídeos", news: " notícias" }[mode] || "";
  const focused = `${local.searchTerm} "${local.locationText}" ${local.searchHint}${suffix}`.trim();
  return [...new Set([base, focused].map((value) => value.trim()).filter(Boolean))].slice(0, 2);
}

function hasLocalCategoryMatch(context, sourceTokens) {
  return context.synonyms.some((synonym) => {
    const tokens = searchTokens(synonym);
    return tokens.length > 0 && tokens.every((token) => sourceTokens.has(token));
  });
}

function isRelevantResult(query, source) {
  const sourceTokens = new Set(searchTokens(`${source.title} ${source.snippet} ${source.uri}`));
  const local = getLocalSearchContext(query);
  if (local) {
    const hasLocation = !local.locationTokens.length || local.locationTokens.every((token) => sourceTokens.has(token));
    return hasLocation && hasLocalCategoryMatch(local, sourceTokens);
  }
  const queryTokens = [...new Set(searchTokens(query))];
  if (!queryTokens.length) return true;
  const matched = queryTokens.filter((token) => sourceTokens.has(token)).length;
  if (queryTokens.length === 1) return matched === 1;
  // Buscadores já fazem a primeira etapa de relevância. Para perguntas naturais,
  // exigir dois tokens derruba consultas válidas como "o que é inteligência artificial".
  return matched >= 1 && matched / queryTokens.length >= 0.25;
}

function relevanceScore(query, source) {
  const queryTokens = [...new Set(searchTokens(query))];
  if (!queryTokens.length) return 0;
  const titleTokens = new Set(searchTokens(source.title));
  const snippetTokens = new Set(searchTokens(source.snippet));
  let score = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const titleMatch = titleTokens.has(token);
    const snippetMatch = snippetTokens.has(token);
    if (titleMatch || snippetMatch) matched += 1;
    if (titleMatch) score += 4;
    if (snippetMatch) score += 1.25;
  }
  score += (matched / queryTokens.length) * 5;
  const phrase = foldSearchText(query);
  if (phrase.length > 9 && foldSearchText(source.title).includes(phrase)) score += 6;
  try {
    const host = new URL(source.uri).hostname.toLowerCase();
    if (host.endsWith(".gov.br") || host.endsWith(".gov") || host.endsWith(".edu.br") || host.endsWith(".edu")) score += 1.5;
  } catch {}
  return score;
}

function rankAndDedupeResults(query, values, maximum = 8) {
  const deduplicated = new Map();
  let order = 0;
  for (const item of Array.isArray(values) ? values : []) {
    const uri = safeSearchResultUrl(item?.uri);
    const title = cleanText(item?.title).slice(0, 180);
    if (!uri || !title) continue;
    const key = canonicalSearchUrl(uri);
    if (!key) continue;
    const candidate = { title, uri, snippet: cleanText(item?.snippet).slice(0, 500), order: order++ };
    const existing = deduplicated.get(key);
    if (!existing) deduplicated.set(key, candidate);
    else {
      if (candidate.snippet.length > existing.snippet.length) existing.snippet = candidate.snippet;
      if (candidate.title.length > existing.title.length) existing.title = candidate.title;
    }
  }
  return [...deduplicated.values()]
    .filter((source) => isRelevantResult(query, source))
    .map((source) => ({ ...source, score: relevanceScore(query, source) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, maximum)
    .map(({ title, uri, snippet }) => ({ title, uri, snippet }));
}

module.exports = {
  buildSearchQuery,
  canonicalSearchUrl,
  decodeBingRedirect,
  getLocalSearchContext,
  getSearchQueryVariants,
  isPublicAddress,
  isSafePublicHostname,
  normalizeSearchQuery,
  parseBingResults,
  parseBingRssResults,
  parseDuckResults,
  rankAndDedupeResults,
  safeSearchResultUrl,
};
