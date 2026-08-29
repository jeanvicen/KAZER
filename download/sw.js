const CACHE_NAME = "kazer-shell-v9";
const APP_SHELL = [
  "/chat",
  "/chat.html",
  "/login",
  "/login.html",
  "/download/manifest.webmanifest",
  "/download/assets/kazer-logo.jpg",
  "/download/assets/kazer-login-symbol.png",
  "/download/icons/kazer-192.png",
  "/download/icons/kazer-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellRequest = APP_SHELL.includes(url.pathname);
  if (request.method !== "GET" || !isSameOrigin || !isAppShellRequest) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.status === 200 && response.type !== "opaque") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => {
          return caches.match(request).then((cached) => cached || caches.match(url.pathname));
    })
  );
});
