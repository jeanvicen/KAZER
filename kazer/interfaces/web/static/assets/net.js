// Rede do KAZER: pedidos com prazo, novas tentativas com espera crescente,
// detecção real de queda (não só o `navigator.onLine`, que mente) e a tela
// offline personalizada. Nada aqui guarda dados da conversa no navegador.

const listeners = new Set();
let status = navigator.onLine === false ? "offline" : "online";
let probing = null;
let attempt = 0;
let nextProbeAt = 0;
let probeTimer = 0;

export const net = {
  get status() {
    return status;
  },
  get nextProbeAt() {
    return nextProbeAt;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Falha de rede vista por algum pedido: confirma com uma sonda antes de declarar queda.
  report() {
    if (status === "online") this.check();
  },
  check,
  retryNow() {
    window.clearTimeout(probeTimer);
    return check();
  },
};

function emit() {
  for (const fn of listeners) {
    try {
      fn(status);
    } catch {
      /* um ouvinte com erro não derruba os outros */
    }
  }
}

function setStatus(next) {
  if (next === status) return;
  status = next;
  if (next === "online") {
    attempt = 0;
    nextProbeAt = 0;
    window.clearTimeout(probeTimer);
  }
  emit();
}

async function ping(timeout = 4500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`/api/health?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

// Sonda única por vez; se falhar, agenda a próxima com espera crescente (1s → 30s).
function check() {
  if (probing) return probing;
  probing = (async () => {
    let ok = await ping();
    if (!ok && status === "online") ok = await ping(6000); // uma segunda chance antes de alarmar
    probing = null;
    if (ok) {
      setStatus("online");
      return true;
    }
    attempt += 1;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4);
    nextProbeAt = Date.now() + wait;
    setStatus("offline");
    emit(); // atualiza a contagem regressiva mesmo sem troca de estado
    window.clearTimeout(probeTimer);
    probeTimer = window.setTimeout(check, wait);
    return false;
  })();
  return probing;
}

window.addEventListener("offline", () => {
  setStatus("offline");
  check();
});
window.addEventListener("online", () => check());
// Voltando para a aba depois de um tempo: confere de novo.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && status === "offline") net.retryNow();
});

export function waitOnline() {
  if (status === "online") return Promise.resolve();
  return new Promise((resolve) => {
    const off = net.subscribe((next) => {
      if (next === "online") {
        off();
        resolve();
      }
    });
  });
}

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const RETRYABLE = new Set([502, 503, 504]);

// Pedido JSON. Métodos idempotentes repetem em queda/instabilidade; POST só se `retry` for pedido.
export async function request(path, options = {}) {
  const {
    method = options.body === undefined ? "GET" : "POST",
    body,
    raw,
    headers = {},
    timeout = 20000,
    signal,
  } = options;
  const idempotent = method === "GET" || method === "DELETE";
  const retries = options.retries ?? (idempotent ? 2 : 0);

  for (let tryNumber = 0; ; tryNumber += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(abort, timeout);
    const init = {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
    };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    try {
      const response = await fetch(path, init);
      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      if (!response.ok && !data.error) data.error = "server";
      if (response.status === 401 && data.error === "unauthenticated") {
        window.dispatchEvent(new CustomEvent("kazer:unauthenticated"));
      }
      if (RETRYABLE.has(response.status) && tryNumber < retries) {
        await sleep(backoff(tryNumber, response.headers.get("retry-after")));
        continue;
      }
      if (status === "offline") net.check();
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      if (signal?.aborted) return { ok: false, status: 0, data: { error: "aborted" } };
      const timedOut = controller.signal.aborted;
      net.report();
      if (tryNumber < retries) {
        await sleep(backoff(tryNumber));
        if (status === "offline") await Promise.race([waitOnline(), sleep(8000)]);
        continue;
      }
      return { ok: false, status: 0, data: { error: timedOut ? "timeout" : "network" } };
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function backoff(tryNumber, retryAfter) {
  const hinted = Number(retryAfter);
  if (hinted > 0 && hinted < 30) return hinted * 1000;
  return 500 * 2 ** tryNumber + Math.random() * 300;
}

// Lê uma resposta NDJSON linha a linha conforme os bytes chegam.
export async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            yield JSON.parse(line);
          } catch {
            /* linha corrompida: ignora */
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
    const rest = buffer.trim();
    if (rest) {
      try {
        yield JSON.parse(rest);
      } catch {
        /* ignora */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------- Tela offline ----------

let screen = null;
let loading = null;

function loadScreen() {
  loading ||= import("./offline.js").then(({ createOfflineScreen }) => {
    screen = createOfflineScreen({ onRetry: () => net.retryNow() });
    return screen;
  });
  return loading;
}

// Pré-carrega o módulo enquanto há rede, para a tela existir quando ela cair.
export function startNetworkUi() {
  const warm = () => loadScreen().catch(() => {
    loading = null;
  });
  if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 4000 });
  else window.setTimeout(warm, 1500);

  net.subscribe(async (next) => {
    if (next === "offline") {
      try {
        (await loadScreen()).show(net.nextProbeAt);
      } catch {
        /* sem o módulo e sem rede: o navegador mostra o próprio aviso */
      }
    } else if (screen) {
      screen.hide();
    }
  });
  if (status === "offline") check();
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (window.location.protocol !== "https:" && !local) return;
  const register = () =>
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* sem service worker: o app funciona igual, só sem tela offline ao abrir sem rede */
    });
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
