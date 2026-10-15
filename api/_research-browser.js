const net = require("node:net");
const { isPublicAddress, isSafePublicHostname } = require("./_research-search-utils");
const { parsePublicUrl, resolvePublicAddress, requestPinnedUrl } = require("./_ssrf");

const MAX_TEXT_CHARS = 18_000;
const MAX_LINKS = 80;
const MAX_BROWSER_RESPONSE_BYTES = 1_500_000;
const MAX_BROWSER_REDIRECTS = 5;
const BROWSER_HOP_BY_HOP_HEADERS = new Set([
  "accept-encoding", "connection", "host", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
]);
function isPrivateAddress(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return net.isIP(host) ? !isPublicAddress(host) : !isSafePublicHostname(host);
}

async function assertSafeUrl(value) {
  let url;
  try { url = parsePublicUrl(value, { protocols: ["https:", "http:"] }); }
  catch (error) { throw new Error(error?.message === "unsafe_public_port" ? "unsafe_research_port" : "unsafe_research_url"); }
  try { await resolvePublicAddress(url.hostname); }
  catch { throw new Error("unsafe_research_dns_destination"); }
  return url.href;
}

function cleanText(value, limit = MAX_TEXT_CHARS) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function playwrightModule() {
  try { return require("playwright-core"); } catch { return null; }
}

function executablePath() {
  return String(process.env.KAZER_BROWSER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || "/usr/bin/chromium").trim();
}

function browserRedirectCount(request) {
  let count = 0;
  let current = request;
  while (typeof current?.redirectedFrom === "function") {
    current = current.redirectedFrom();
    if (!current) break;
    count += 1;
    if (count > MAX_BROWSER_REDIRECTS) return count;
  }
  return count;
}

function safeBrowserRequestHeaders(input) {
  const headers = { ...(input && typeof input === "object" ? input : {}) };
  for (const name of Object.keys(headers)) {
    if (BROWSER_HOP_BY_HOP_HEADERS.has(name.toLowerCase())) delete headers[name];
  }
  return headers;
}

async function fulfillPinnedBrowserRequest(route, {
  resolveAddress = resolvePublicAddress,
  pinnedRequest = requestPinnedUrl,
} = {}) {
  const browserRequest = route.request();
  if (browserRedirectCount(browserRequest) > MAX_BROWSER_REDIRECTS) throw new Error("research_redirect_limit");

  const url = parsePublicUrl(browserRequest.url(), { protocols: ["https:", "http:"] });
  const address = await resolveAddress(url.hostname);
  const body = typeof browserRequest.postDataBuffer === "function" ? browserRequest.postDataBuffer() : null;
  const response = await pinnedRequest(url, address, {
    method: browserRequest.method(),
    headers: safeBrowserRequestHeaders(browserRequest.headers()),
    body,
    timeoutMs: 10_000,
    maxBytes: MAX_BROWSER_RESPONSE_BYTES,
  });
  const headers = Object.fromEntries(response.headers.entries());
  const responseBody = Buffer.from(await response.arrayBuffer());
  await route.fulfill({ status: response.status, headers, body: responseBody });
}

class ResearchBrowser {
  constructor({ maxActions = 12 } = {}) {
    this.maxActions = maxActions;
    this.actions = 0;
    this.browser = null;
    this.context = null;
    this.pages = [];
    this.activePage = null;
    this.available = false;
  }

  async start() {
    const playwright = playwrightModule();
    if (!playwright) return { available: false, reason: "playwright_not_installed" };
    try {
      this.browser = await playwright.chromium.launch({ headless: true, executablePath: executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      this.context = await this.browser.newContext({ javaScriptEnabled: true, serviceWorkers: "block", userAgent: "KAZER-Research/1.0" });
      if (typeof this.context.routeWebSocket !== "function") throw new Error("research_websocket_route_unavailable");
      await this.context.routeWebSocket("**/*", (socket) => {
        socket.close({ code: 1008, reason: "WebSockets are disabled in read-only research" });
      });
      await this.context.route("**/*", async (route) => {
        try { await fulfillPinnedBrowserRequest(route); }
        catch { await route.abort("blockedbyclient").catch(() => null); }
      });
      this.available = true;
      return { available: true };
    } catch (error) {
      await this.close();
      return { available: false, reason: String(error?.message || "browser_unavailable").slice(0, 180) };
    }
  }

  async close() { try { await this.context?.close(); } catch {} try { await this.browser?.close(); } catch {} this.context = null; this.browser = null; this.pages = []; this.activePage = null; }
  ensureAction() { if (!this.available) throw new Error("browser_unavailable"); if (this.actions >= this.maxActions) throw new Error("research_action_limit"); this.actions += 1; return this.activePage; }
  async open(url) { this.ensureAction(); const safe = await assertSafeUrl(url); const page = this.activePage || await this.context.newPage(); if (!this.pages.includes(page)) this.pages.push(page); this.activePage = page; await page.goto(safe, { waitUntil: "domcontentloaded", timeout: 12_000 }); return this.snapshot(); }
  async wait(milliseconds = 800) { const page = this.ensureAction(); await page.waitForTimeout(Math.min(3_000, Math.max(0, Number(milliseconds) || 0))); return this.snapshot(); }
  async click(selector) { const page = this.ensureAction(); await page.locator(String(selector || "").slice(0, 300)).first().click({ timeout: 5_000 }); return this.snapshot(); }
  async find(text) { const page = this.ensureAction(); const body = cleanText(await page.locator("body").innerText().catch(() => "")); const needle = cleanText(text, 240).toLocaleLowerCase(); const index = body.toLocaleLowerCase().indexOf(needle); return { found: index >= 0, excerpt: index >= 0 ? body.slice(Math.max(0, index - 300), index + needle.length + 700) : "" }; }
  async scroll() { const page = this.ensureAction(); await page.evaluate(() => window.scrollBy(0, Math.max(300, Math.floor(window.innerHeight * 0.8)))); return this.snapshot(); }
  async back() { const page = this.ensureAction(); await page.goBack({ waitUntil: "domcontentloaded", timeout: 8_000 }).catch(() => null); return this.snapshot(); }
  async forward() { const page = this.ensureAction(); await page.goForward({ waitUntil: "domcontentloaded", timeout: 8_000 }).catch(() => null); return this.snapshot(); }
  async openTab(url) { this.ensureAction(); const safe = await assertSafeUrl(url); const page = await this.context.newPage(); this.pages.push(page); this.activePage = page; await page.goto(safe, { waitUntil: "domcontentloaded", timeout: 12_000 }); return this.snapshot(); }
  async closeTab() { const page = this.ensureAction(); await page.close(); this.pages = this.pages.filter((candidate) => candidate !== page); this.activePage = this.pages.at(-1) || null; return this.snapshot(); }
  async screenshot() { const page = this.ensureAction(); return { url: page.url(), screenshot: (await page.screenshot({ type: "png" })).toString("base64").slice(0, 200_000) }; }
  async extract() { const page = this.ensureAction(); return this.snapshot(); }
  async snapshot() {
    const page = this.activePage;
    if (!page) return { url: "", title: "", text: "", headings: [], links: [] };
    const data = await page.evaluate((maxLinks) => ({ title: document.title || "", text: document.body?.innerText || "", headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => node.innerText).filter(Boolean).slice(0, 40), links: [...document.querySelectorAll("a[href]")].map((node) => ({ text: node.innerText || node.getAttribute("aria-label") || "", href: node.href })).filter((item) => item.text || item.href).slice(0, maxLinks) }), MAX_LINKS).catch(() => ({ title: "", text: "", headings: [], links: [] }));
    return { url: page.url(), title: cleanText(data.title, 300), text: cleanText(data.text), pageRead: true, headings: data.headings.map((value) => cleanText(value, 240)), links: data.links.map((item) => ({ text: cleanText(item.text, 180), href: String(item.href || "").slice(0, 1000) })) };
  }
}

module.exports = { ResearchBrowser, assertSafeUrl, fulfillPinnedBrowserRequest, isPrivateAddress, cleanText };
