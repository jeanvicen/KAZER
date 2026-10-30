// Service worker do KAZER: guarda só a "casca" do app (HTML, CSS, JS, fonte e
// ícones) para a tela offline aparecer mesmo abrindo sem internet.
// Nunca guarda nada de /api/: conversas, anexos e sessão não ficam em cache.
// Rede primeiro: com internet, cada deploy novo aparece na hora.

const CACHE = "kazer-shell-v3";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/assets/kazer.css",
  "/assets/chat.css",
  "/assets/app.js",
  "/assets/dom.js",
  "/assets/net.js",
  "/assets/offline.js",
  "/assets/intro.js",
  "/assets/scene.js",
  "/assets/chat.js",
  "/assets/markdown.js",
  "/assets/sheets.js",
  "/assets/squares.js",
  "/assets/settings.js",
  "/assets/voice.js",
  "/assets/pixel.js",
  "/assets/fonts/grenze-gotisch-500.woff2",
  "/assets/brand/favicon.svg",
  "/assets/brand/icon-192.png",
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Um arquivo que falhar não impede a instalação dos outros.
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => null))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("kazer-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(url) {
  return url.origin === self.location.origin && !url.pathname.startsWith("/api/") && url.pathname !== "/sw.js";
}

// Rede primeiro com prazo; sem rede (ou lenta demais), a cópia guardada.
async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === "basic") cache.put(fallbackKey || request, response.clone());
    return response;
  });
  network.catch(() => null); // a falha é tratada abaixo; evita rejeição solta
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await cache.match(fallbackKey || request);
    return cached || (await network);
  } catch {
    const cached = await cache.match(fallbackKey || request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!cacheable(url)) return; // API e outros domínios: direto para a rede, sem cache

  if (request.mode === "navigate") {
    // Qualquer página do app (/, /c/...) usa a mesma casca guardada em "/".
    const isApp = url.pathname === "/" || url.pathname.startsWith("/c/");
    event.respondWith(networkFirst(request, isApp ? "/" : undefined));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
  }
});
