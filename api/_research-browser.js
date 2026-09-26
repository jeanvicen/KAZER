const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_TEXT_CHARS = 18_000;
const MAX_LINKS = 80;
const PRIVATE_METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.google.internal.", "169.254.169.254", "168.63.129.16"]);

function isPrivateAddress(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || PRIVATE_METADATA_HOSTS.has(host)) return true;
  const version = net.isIP(host);
  if (version === 4) {
    const p = host.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
  }
  if (version === 6) return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host) || host.startsWith("::ffff:127.");
  return false;
}

async function assertSafeUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("unsafe_research_url"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("unsafe_research_url");
  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  if ((url.protocol === "https:" && port !== 443) || (url.protocol === "http:" && port !== 80)) throw new Error("unsafe_research_port");
  if (isPrivateAddress(url.hostname)) throw new Error("unsafe_research_destination");
  if (!net.isIP(url.hostname)) {
    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("unsafe_research_dns_destination");
  }
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
      this.context = await this.browser.newContext({ javaScriptEnabled: true, userAgent: "KAZER-Research/1.0" });
      await this.context.route("**/*", async (route) => {
        try {
          const target = await assertSafeUrl(route.request().url());
          await route.continue({ url: target });
        } catch { await route.abort("blockedbyclient"); }
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

module.exports = { ResearchBrowser, assertSafeUrl, isPrivateAddress, cleanText };
