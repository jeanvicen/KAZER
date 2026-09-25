import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const intent = require(`${root}/interface/web-search-intent.js`);
const utils = require(`${root}/api/_web-search-utils.js`);

const positive = [
  "Quanto está o dólar hoje?",
  "Dólar hoje",
  "previsão do tempo para amanhã em Ivaiporã",
  "Quem é o presidente do Brasil atualmente?",
  "Qual foi o placar do jogo do Brasil ontem?",
  "Preço do iPhone 17 agora",
  "Qual é a versão mais recente do Node.js?",
  "Tem vaga de estágio em Ivaiporã esta semana",
  "O restaurante está aberto agora?",
  "Quais são as notícias de hoje sobre tecnologia?",
  "Pesquise a história da internet",
];
for (const question of positive) assert.equal(intent.isWebResearchRequest(question), true, `Deveria pesquisar: ${question}`);

const negative = [
  "O que é a taxa Selic?",
  "Como funciona o câmbio?",
  "Explique o que é previsão do tempo.",
  "Me ensine a converter dólar para real.",
  "A história do futebol brasileiro",
  "Qual é a capital da França?",
  "Quanto é 2 + 2?",
  "Não precisa pesquisar, só explique o conceito de inflação.",
  "Sem pesquisar na internet, me explique como funciona o dólar.",
];
for (const question of negative) assert.equal(intent.isWebResearchRequest(question), false, `Não deveria pesquisar: ${question}`);

for (const command of ["Não pesquise isso", "Não precisa pesquisar, só responda", "Sem pesquisar na web: quanto está o dólar hoje?", "Não consulte a internet: só me explique o conceito.", "Não faça pesquisa, só me diga quanto está o dólar hoje."]) {
  assert.equal(intent.isSearchOptOut(command), true, `Opt-out não reconhecido: ${command}`);
  assert.equal(intent.isWebResearchRequest(command), false, `Opt-out deve prevalecer: ${command}`);
}

assert.equal(intent.isResearchFollowUp("E no Brasil?", "Quanto está o dólar hoje?"), true);
assert.equal(intent.buildResearchQuery("E no Brasil?", "Quanto está o dólar hoje?"), "Quanto está o dólar hoje? no Brasil?");
assert.equal(intent.isResearchFollowUp("Me explica isso melhor", "Quanto está o dólar hoje?"), false);
assert.equal(intent.isResearchFollowUp("E no Brasil?", "O que é a taxa Selic?"), false);
assert.equal(intent.isResearchFollowUp("E no Brasil?", "Quanto está o dólar hoje?"), true);

assert.equal(utils.normalizeSearchQuery("Por favor, pesquise quanto está o dólar hoje?"), "dólar hoje");
assert.equal(utils.normalizeSearchQuery("Pesquise na web quanto está o dólar hoje?"), "dólar hoje");
assert.equal(utils.normalizeSearchQuery("Me diga qual é o preço do Bitcoin agora?"), "Bitcoin agora");
assert.equal(utils.normalizeSearchQuery("  notícias recentes sobre tecnologia  "), "notícias recentes sobre tecnologia");

const bingHtml = `<ol><li class="b_algo"><h2><a href="https://www.gov.br/economia/noticias?utm_source=bing&amp;x=1">Dólar hoje: cotação oficial</a></h2><div class="b_caption"><p>Veja a cotação do dólar hoje e dados do mercado.</p></div></li><li class="b_algo"><h2><a href="https://127.0.0.1/admin">Resultado local</a></h2><p>Não pode entrar.</p></li></ol>`;
const bing = utils.parseBingResults(bingHtml);
assert.equal(bing.length, 1);
assert.equal(bing[0].title, "Dólar hoje: cotação oficial");
assert.match(bing[0].snippet, /cotação do dólar hoje/);

const duckHtml = `<div class="result results_links"><a class="result__a" href="//example.org/cambio?utm_medium=ddg">Cotação do dólar no Brasil</a><a class="result__snippet">Confira o valor atualizado do dólar hoje.</a></div><div class="result results_links"><a class="result__a" href="https://example.net/other">Outra fonte</a><div class="result__snippet">Trecho de outra fonte.</div></div>`;
const duck = utils.parseDuckResults(duckHtml);
assert.equal(duck.length, 2);
assert.match(duck[0].snippet, /valor atualizado/);

const ranked = utils.rankAndDedupeResults("dólar hoje cotação", [
  { title: "Página fora do assunto", uri: "https://irrelevante.example.org/a", snippet: "Conteúdo genérico." },
  { title: "Cotação do dólar hoje", uri: "https://www.gov.br/economia/cotacao?utm_source=bing", snippet: "Valor atualizado do dólar." },
  { title: "Cotação do dólar", uri: "https://gov.br/economia/cotacao?utm_campaign=duck", snippet: "Fonte duplicada e com mais detalhes sobre dólar hoje." },
]);
assert.equal(ranked.length, 2, "Variantes com parâmetros de rastreamento devem ser deduplicadas");
assert.match(ranked[0].title, /Cotação do dólar hoje/);
assert.match(ranked[0].snippet, /mais detalhes/, "A duplicata deve contribuir com o melhor trecho disponível");
assert.equal(utils.isPublicAddress("8.8.8.8"), true);
assert.equal(utils.isPublicAddress("192.0.2.10"), false);
assert.equal(utils.isPublicAddress("127.0.0.1"), false);
assert.equal(utils.isPublicAddress("169.254.169.254"), false);
assert.equal(utils.isPublicAddress("168.63.129.16"), false);
assert.equal(utils.isPublicAddress("::1"), false);
assert.equal(utils.isPublicAddress("2001:db8::1"), false);
assert.equal(utils.isPublicAddress("2001:4860:4860::8888"), true);
assert.equal(utils.isPublicAddress("2001:200::1"), true, "Não deve bloquear sem motivo um IPv6 global válido");
assert.equal(utils.isPublicAddress("2001:2::1"), false, "O bloco de benchmark IPv6 não deve ser público");
assert.equal(utils.isPublicAddress("3fff::1"), false, "O bloco documental IPv6 não deve ser público");
assert.equal(utils.safeSearchResultUrl("http://localhost/admin"), null);
assert.equal(utils.safeSearchResultUrl("http://169.254.169.254/latest/meta-data"), null);
assert.equal(utils.safeSearchResultUrl("http://[::ffff:127.0.0.1]/"), null);
assert.equal(utils.safeSearchResultUrl("file:///etc/passwd"), null);

const api = await readFile(`${root}/api/web-search.js`, "utf8");
const chat = await readFile(`${root}/interface/chat.html`, "utf8");
assert.match(chat, /<script src="\/interface\/web-search-intent\.js"><\/script>/);
assert.match(chat, /files\.length === 0 \? getWebResearchRequest\(prompt, previousUserPrompt\)/, "A pesquisa automática deve respeitar anexos e contexto");
assert.match(chat, /billingQuery: prompt/);
assert.match(chat, /source\?\.pageRead === true/);
assert.match(api, /Promise\.allSettled\(providers\.map\(fetchSearchProvider\)\)/, "Bing e DuckDuckGo devem ser consultados em paralelo");
assert.match(api, /MAX_PAGE_REDIRECTS = 3/);
assert.match(api, /requestPinnedUrl/);
assert.match(api, /pageRead: Boolean\(source\.pageRead\)/);
assert.doesNotMatch(api, /pageText:\s*source\.pageText/, "O texto das páginas não deve voltar na resposta da API");
assert.match(api, /process\.env\.HF_TOKEN, process\.env\.GROQ_API_KEY/);
assert.match(api, /conteúdo externo não confiável/);
console.log("web-search-regression: OK — intenção, opt-out, contexto, parser, ranking, deduplicação e destinos privados.");
