const { isIP } = require("node:net");

const SEARCH_STOP_WORDS = new Set((
  "a ao aos as o os de da das do dos em no nos na nas por para com sem sobre e ou um uma uns umas que qual quais quem quando onde como quanto quantos quantas me meu minha seus suas seu sua voce vc pode poderia gostaria quero queria preciso pesquisar pesquisa busque buscar procura procurar encontre encontrar hoje agora atualmente atual recente recentes mais melhor melhores isso aquilo esta estao eh the a an and are as at be by for from how in into is it of on or that this to with what when where which who why will today current latest"
).split(/\s+/));

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

function parseIpv6(value) {
  let address = String(value || "").toLowerCase();
  if (address.includes("%")) return null;
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = address.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[\da-f]{1,4}$/.test(word))) return null;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

function isPublicAddress(value) {
  const address = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c, d] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 168 && b === 63 && c === 129 && d === 16) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const parsed = parseIpv6(address);
    if (parsed === null) return false;
    const globalUnicastStart = 0x20000000000000000000000000000000n;
    const globalUnicastEnd = 0x40000000000000000000000000000000n;
    if (parsed < globalUnicastStart || parsed >= globalUnicastEnd) return false;
    const hasPrefix = (prefix, bits) => (parsed >> BigInt(128 - bits)) === prefix;
    if (hasPrefix(0x20010000n, 32) || hasPrefix(0x20010db8n, 32)) return false;
    if (hasPrefix(0x200100020000n, 48)) return false;
    if (hasPrefix(0x2001001n, 28) || hasPrefix(0x2001002n, 28)) return false;
    if (hasPrefix(0x2002n, 16) || hasPrefix(0x3fff0n, 20)) return false;
    return true;
  }
  return false;
}

function isSafePublicHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname === "metadata" || hostname === "instance-data" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".example") || hostname.endsWith(".invalid") || hostname.endsWith(".onion")) return false;
  const family = isIP(hostname);
  if (family) return isPublicAddress(hostname);
  return hostname.includes(".");
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

function searchTokens(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token));
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
  const phrase = cleanText(query).toLowerCase();
  if (phrase.length > 9 && cleanText(source.title).toLowerCase().includes(phrase)) score += 6;
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
    .map((source) => ({ ...source, score: relevanceScore(query, source) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, maximum)
    .map(({ title, uri, snippet }) => ({ title, uri, snippet }));
}

module.exports = {
  buildSearchQuery,
  canonicalSearchUrl,
  decodeBingRedirect,
  isPublicAddress,
  isSafePublicHostname,
  normalizeSearchQuery,
  parseBingResults,
  parseDuckResults,
  rankAndDedupeResults,
  safeSearchResultUrl,
};
