/*
 * KAZER — fontes especializadas, classificador e widgets de pesquisa.
 * Adaptado das ideias do Vane (github.com/ItzCrazyKns/Vane, licença MIT,
 * © 2026 ItzCrazyKns): classificação da pergunta, fontes por foco
 * (web, acadêmico, discussões), modos speed/balanced/quality e widgets
 * de clima, cálculo e cotação. Tudo roda sem chave; SearxNG é opcional.
 */
const { cleanText } = require("./_research-browser");

const TIMEOUT_MS = 7_000;
const MAX_BYTES = 1_500_000;
const UA = "KAZER-Research/3.0 (+https://kazer.vercel.app)";

// Modos herdados do Vane. Free fica em "balanced"; Pro libera "quality".
const MODES = {
  speed: { searches: 2, pages: 4, perSource: 4, sources: ["web", "wiki"] },
  balanced: { searches: 4, pages: 8, perSource: 5, sources: ["web", "wiki", "academic", "discussions", "code", "news", "video"] },
  quality: { searches: 12, pages: 20, perSource: 10, sources: ["web", "wiki", "academic", "discussions", "code", "news", "video"] },
};

const PATTERNS = {
  greeting: /^\s*(?:oi|olá|ola|bom dia|boa tarde|boa noite|e a[ií]|hey|hi|hello|obrigad[oa]|valeu)[\s!.?]*$/i,
  academic: /\b(?:artigos?|papers?|estudos?|pesquisas? cient[ií]ficas?|cient[ií]fic[oa]s?|acad[eê]mic[oa]s?|revis[aã]o sistem[aá]tica|meta-?an[aá]lises?|cita[cç][aãoõ]+e?s?|refer[eê]ncias|arxiv|pubmed|doi|research|study|studies|scholar|journals?|peer[- ]review)\b/i,
  discussions: /\b(?:opini[aã]o|opini[oõ]es|o que (?:as pessoas|o pessoal|a galera) (?:acha|pensa|diz)|reddit|f[oó]rum|review|reviews|avalia[cç][oõ]es|experi[eê]ncias?|vale a pena|recomenda|people think|discussion|community)\b/i,
  code: /\b(?:c[oó]digo|code|erro|error|exception|stack ?trace|bug|biblioteca|library|framework|api|npm|pip|github|stack ?overflow|javascript|typescript|python|react|node|godot|unity|sql|css|html|rust|golang|kotlin|swift)\b/i,
  news: /\b(?:not[ií]cia|not[ií]cias|hoje|ontem|agora|[uú]ltimas?|recente|atualiza[cç][aã]o|aconteceu|elei[cç][aã]o|news|today|latest|breaking)\b/i,
  video: /\b(?:v[ií]deo|v[ií]deos|youtube|tutorial em v[ií]deo|assistir|watch)\b/i,
  weather: /\b(?:clima|tempo|previs[aã]o|temperatura|vai chover|chuva|weather|forecast)\b/i,
  stock: /\b(?:a[cç][aã]o|a[cç][oõ]es|cota[cç][aã]o|bolsa|ticker|stock|share price|pre[cç]o da a[cç][aã]o)\b/i,
  calc: /^[\s\d.,+\-*/x×÷^%()=]+$|\b(?:quanto [eé]|calcule|calcular|resultado de|porcento|por cento|% de|raiz quadrada|square root)\b/i,
};

function classifyQuestion(question) {
  const text = String(question || "");
  const greeting = PATTERNS.greeting.test(text);
  const weather = PATTERNS.weather.test(text) && !PATTERNS.code.test(text);
  const calcExpression = extractExpression(text);
  return {
    skipSearch: greeting,
    academic: PATTERNS.academic.test(text),
    discussions: PATTERNS.discussions.test(text),
    code: PATTERNS.code.test(text),
    news: PATTERNS.news.test(text),
    video: PATTERNS.video.test(text),
    weather,
    stock: PATTERNS.stock.test(text) && /\b(?:[A-Z]{4}\d{1,2}|[A-Z]{2,5})\b/.test(text),
    calculation: Boolean(calcExpression),
    calcExpression,
  };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`source_${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("source_too_large");
  return JSON.parse(text);
}

async function getText(url) {
  const response = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`source_${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("source_too_large");
  return text;
}

const result = (kind, title, uri, snippet, extra = {}) => ({ kind, title: cleanText(title, 240) || "Fonte", uri: String(uri || ""), snippet: cleanText(snippet, 700), ...extra });
const isHttps = (value) => /^https:\/\//i.test(String(value || ""));

/* ── Adaptadores de fonte ─────────────────────────────────────────────── */
const ADAPTERS = {
  async searxng(query, limit, { engines, categories } = {}) {
    const base = String(process.env.SEARXNG_URL || "").trim().replace(/\/$/, "");
    if (!isHttps(base)) return [];
    const url = new URL(`${base}/search`);
    url.searchParams.set("format", "json");
    url.searchParams.set("q", query);
    url.searchParams.set("language", "pt-BR");
    if (engines) url.searchParams.set("engines", engines.join(","));
    if (categories) url.searchParams.set("categories", categories.join(","));
    const data = await getJson(url);
    return (data.results || []).filter((item) => isHttps(item.url)).slice(0, limit).map((item) => result(categories?.includes("videos") ? "video" : "web", item.title, item.url, item.content, { thumbnail: isHttps(item.thumbnail_src || item.img_src) ? item.thumbnail_src || item.img_src : undefined }));
  },
  async wiki(query, limit) {
    const lang = /[ãõçáéíóúâêô]|\b(?:o|a|de|que|como|qual|quem)\b/i.test(query) ? "pt" : "en";
    const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`);
    return (data.query?.search || []).map((item) => result("wiki", item.title, `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`, String(item.snippet || "").replace(/<[^>]+>/g, "")));
  },
  async academic(query, limit) {
    const [openalex, arxiv] = await Promise.allSettled([
      getJson(`https://api.openalex.org/works?per-page=${limit}&search=${encodeURIComponent(query)}&select=id,doi,title,publication_year,cited_by_count,primary_location,abstract_inverted_index`),
      getText(`https://export.arxiv.org/api/query?max_results=${Math.min(limit, 6)}&search_query=all:${encodeURIComponent(query)}`),
    ]);
    const items = [];
    if (openalex.status === "fulfilled") {
      for (const work of openalex.value.results || []) {
        const abstract = work.abstract_inverted_index ? Object.entries(work.abstract_inverted_index).flatMap(([word, positions]) => positions.map((position) => [position, word])).sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(" ") : "";
        const link = work.doi || work.primary_location?.landing_page_url || work.id;
        if (isHttps(link)) items.push(result("academic", work.title, link, abstract, { year: work.publication_year, citations: work.cited_by_count }));
      }
    }
    if (arxiv.status === "fulfilled") {
      for (const entry of arxiv.value.split("<entry>").slice(1)) {
        const pick = (tag) => (entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
        const link = pick("id").trim().replace(/^http:/, "https:");
        if (isHttps(link)) items.push(result("academic", pick("title"), link, pick("summary"), { year: Number(pick("published").slice(0, 4)) || undefined, venue: "arXiv" }));
      }
    }
    return items.slice(0, limit * 2);
  },
  async discussions(query, limit) {
    const [hn, reddit] = await Promise.allSettled([
      getJson(`https://hn.algolia.com/api/v1/search?hitsPerPage=${limit}&query=${encodeURIComponent(query)}`),
      getJson(`https://www.reddit.com/search.json?limit=${limit}&sort=relevance&q=${encodeURIComponent(query)}`),
    ]);
    const items = [];
    if (reddit.status === "fulfilled") {
      for (const { data } of reddit.value.data?.children || []) items.push(result("discussion", data.title, `https://www.reddit.com${data.permalink}`, data.selftext || `r/${data.subreddit} · ${data.num_comments} comentários`, { site: "Reddit", score: data.score }));
    }
    if (hn.status === "fulfilled") {
      for (const hit of hn.value.hits || []) items.push(result("discussion", hit.title || hit.story_title, `https://news.ycombinator.com/item?id=${hit.objectID}`, hit.story_text || hit.comment_text || `${hit.points || 0} pontos · ${hit.num_comments || 0} comentários`, { site: "Hacker News" }));
    }
    return items;
  },
  async code(query, limit) {
    const [stack, repos] = await Promise.allSettled([
      getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=${limit}&q=${encodeURIComponent(query)}`),
      getJson(`https://api.github.com/search/repositories?per_page=${limit}&q=${encodeURIComponent(query)}`, { Accept: "application/vnd.github+json" }),
    ]);
    const items = [];
    if (stack.status === "fulfilled") {
      for (const item of stack.value.items || []) items.push(result("code", item.title, item.link, `${item.is_answered ? "Respondida" : "Sem resposta aceita"} · ${item.score} votos · ${(item.tags || []).slice(0, 4).join(", ")}`, { site: "Stack Overflow" }));
    }
    if (repos.status === "fulfilled") {
      for (const repo of repos.value.items || []) items.push(result("code", repo.full_name, repo.html_url, `${repo.description || ""} · ★ ${repo.stargazers_count}`, { site: "GitHub" }));
    }
    return items;
  },
  async news(query, limit) {
    const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`);
    return xml.split("<item>").slice(1, limit + 1).map((item) => {
      const pick = (tag) => ((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "");
      return result("news", pick("title"), pick("link").trim(), pick("source") || pick("pubDate"), { date: pick("pubDate") });
    }).filter((item) => isHttps(item.uri));
  },
  async video(query, limit) {
    if (process.env.SEARXNG_URL) return ADAPTERS.searxng(query, limit, { categories: ["videos"] });
    const html = await getText(`https://www.youtube.com/results?hl=pt&search_query=${encodeURIComponent(query)}`);
    const ids = [...new Set([...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((match) => match[1]))].slice(0, limit);
    const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
    return ids.map((id, index) => result("video", titles[index] || "Vídeo no YouTube", `https://www.youtube.com/watch?v=${id}`, "YouTube", { thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }));
  },
};

async function searchSpecializedSources(question, classification, mode = "balanced") {
  const config = MODES[mode] || MODES.balanced;
  const wanted = new Set(["wiki"]);
  if (process.env.SEARXNG_URL) wanted.add("searxng");
  if (mode === "quality") config.sources.forEach((source) => wanted.add(source));
  if (classification.academic) wanted.add("academic");
  if (classification.discussions) wanted.add("discussions");
  if (classification.code) wanted.add("code");
  if (classification.news) wanted.add("news");
  if (classification.video) wanted.add("video");
  const allowed = [...wanted].filter((source) => source === "searxng" || config.sources.includes(source));
  const settled = await Promise.allSettled(allowed.map(async (source) => ({ source, items: await ADAPTERS[source](question, config.perSource) })));
  const items = [];
  const errors = [];
  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled") items.push(...entry.value.items.filter((item) => item.uri));
    else errors.push(`${allowed[index]}:${String(entry.reason?.message || "failed").slice(0, 80)}`);
  });
  return { items, sourcesUsed: allowed, errors };
}

/* ── Widgets ───────────────────────────────────────────────────────────── */
// Calculadora segura (sem eval): + - * / ^ % e parênteses.
function extractExpression(text) {
  const source = String(text || "").toLowerCase().replace(/(\d+(?:[.,]\d+)?)\s*%\s*de\s*(\d+(?:[.,]\d+)?)/g, "($1/100*$2)").replace(/[x×]/g, "*").replace(/÷/g, "/").replace(/(\d),(\d)/g, "$1.$2");
  const match = source.match(/[\d(][\d\s.+\-*/^%()]*[\d)]/);
  if (!match || !/[+\-*/^%]/.test(match[0])) return null;
  return match[0].trim().slice(0, 120);
}

function evaluateExpression(expression) {
  const tokens = String(expression).match(/\d+(?:\.\d+)?|[+\-*/^%()]/g);
  if (!tokens || tokens.join("") !== String(expression).replace(/\s+/g, "")) throw new Error("expression_invalid");
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const primary = () => {
    const token = take();
    if (token === "(") { const value = additive(); if (take() !== ")") throw new Error("expression_invalid"); return value; }
    if (token === "-") return -primary();
    if (token === "+") return primary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("expression_invalid");
    return value;
  };
  const power = () => { let value = primary(); while (peek() === "^") { take(); value = value ** primary(); } return value; };
  const multiplicative = () => {
    let value = power();
    while (["*", "/", "%"].includes(peek())) {
      const op = take();
      const right = power();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const additive = () => { let value = multiplicative(); while (["+", "-"].includes(peek())) { const op = take(); const right = multiplicative(); value = op === "+" ? value + right : value - right; } return value; };
  const value = additive();
  if (position !== tokens.length || !Number.isFinite(value)) throw new Error("expression_invalid");
  return Math.round(value * 1e10) / 1e10;
}

const WEATHER_CODES = { 0: "Céu limpo", 1: "Quase limpo", 2: "Parcialmente nublado", 3: "Nublado", 45: "Neblina", 48: "Neblina", 51: "Garoa", 53: "Garoa", 55: "Garoa forte", 61: "Chuva fraca", 63: "Chuva", 65: "Chuva forte", 71: "Neve", 80: "Pancadas", 81: "Pancadas", 82: "Temporal", 95: "Trovoada", 96: "Trovoada com granizo", 99: "Trovoada com granizo" };

function extractPlace(question) {
  const match = String(question).match(/\b(?:em|no|na|de|in|for)\s+([A-ZÀ-Ú][\wÀ-ú.'-]*(?:\s+(?:de|do|da|dos|das|[A-ZÀ-Ú][\wÀ-ú.'-]*))*)/);
  return match ? match[1].trim() : "";
}

async function weatherWidget(question) {
  const place = extractPlace(question) || "São Paulo";
  const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(place)}`);
  const spot = geo.results?.[0];
  if (!spot) return null;
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5`);
  return {
    type: "weather",
    place: [spot.name, spot.admin1, spot.country].filter(Boolean).join(", "),
    current: { temperature: data.current?.temperature_2m, feelsLike: data.current?.apparent_temperature, humidity: data.current?.relative_humidity_2m, wind: data.current?.wind_speed_10m, condition: WEATHER_CODES[data.current?.weather_code] || "—" },
    daily: (data.daily?.time || []).map((day, index) => ({ day, max: data.daily.temperature_2m_max[index], min: data.daily.temperature_2m_min[index], condition: WEATHER_CODES[data.daily.weather_code[index]] || "—" })),
    source: "Open-Meteo",
  };
}

async function stockWidget(question) {
  const symbol = (String(question).match(/\b([A-Z]{4}\d{1,2}|[A-Z]{1,5})\b/) || [])[1];
  if (!symbol) return null;
  const ticker = /\d$/.test(symbol) ? `${symbol}.SA` : symbol;
  const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`);
  const chart = data.chart?.result?.[0];
  if (!chart) return null;
  const closes = (chart.indicators?.quote?.[0]?.close || []).filter((value) => Number.isFinite(value));
  return { type: "stock", symbol: ticker, currency: chart.meta?.currency, price: chart.meta?.regularMarketPrice, previousClose: chart.meta?.chartPreviousClose, series: closes.slice(-30).map((value) => Math.round(value * 100) / 100), source: "Yahoo Finance" };
}

async function runWidgets(question, classification) {
  const jobs = [];
  if (classification.calculation) jobs.push((async () => ({ type: "calculation", expression: classification.calcExpression, result: evaluateExpression(classification.calcExpression) }))());
  if (classification.weather) jobs.push(weatherWidget(question));
  if (classification.stock) jobs.push(stockWidget(question));
  const settled = await Promise.allSettled(jobs);
  return settled.filter((entry) => entry.status === "fulfilled" && entry.value).map((entry) => entry.value);
}

module.exports = { ADAPTERS, MODES, classifyQuestion, evaluateExpression, extractExpression, runWidgets, searchSpecializedSources };
