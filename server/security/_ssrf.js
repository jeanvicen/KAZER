const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const zlib = require("node:zlib");
const { isPublicAddress, isSafePublicHostname } = require("./_network-address");

const DEFAULT_MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REQUEST_BYTES = 256_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HOP_BY_HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function normalizeHostname(value) {
  return String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parsePublicUrl(value, { protocols = ["https:", "http:"], allowCustomPort = false } = {}) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw new Error("unsafe_public_url"); }

  const hostname = normalizeHostname(url.hostname);
  if (url.href.length > 4096 || !protocols.includes(url.protocol) || url.username || url.password || url.hash || !isSafePublicHostname(hostname)) {
    throw new Error("unsafe_public_url");
  }
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (!allowCustomPort && port !== defaultPort)) {
    throw new Error("unsafe_public_port");
  }
  return url;
}

async function resolvePublicAddress(hostnameValue, resolver = dns.lookup, timeoutMs = 3000) {
  const hostname = normalizeHostname(hostnameValue);
  if (!isSafePublicHostname(hostname)) throw new Error("unsafe_public_destination");

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname)) throw new Error("unsafe_public_destination");
    return { address: hostname, family: literalFamily };
  }

  let timer;
  let records;
  try {
    records = await Promise.race([
      Promise.resolve().then(() => resolver(hostname, { all: true, verbatim: true })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("public_dns_timeout")), timeoutMs); }),
    ]);
  } catch {
    throw new Error("public_dns_resolution_failed");
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(records) || !records.length) throw new Error("unsafe_public_destination");
  const normalized = records.map((record) => {
    const address = normalizeHostname(record?.address);
    const actualFamily = net.isIP(address);
    return { address, family: Number(record?.family) || actualFamily, actualFamily };
  });
  if (normalized.some((record) => !record.actualFamily || record.family !== record.actualFamily || !isPublicAddress(record.address))) {
    throw new Error("unsafe_public_destination");
  }
  return { address: normalized[0].address, family: normalized[0].family };
}

function createPinnedLookup(addressRecord) {
  const address = normalizeHostname(addressRecord?.address);
  const actualFamily = net.isIP(address);
  const family = Number(addressRecord?.family) || actualFamily;
  if (!actualFamily || family !== actualFamily || !isPublicAddress(address)) throw new Error("unsafe_public_destination");
  return (_hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    if (typeof callback !== "function") throw new Error("invalid_dns_callback");
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function normalizeRequestHeaders(input, body) {
  const headers = {};
  const entries = typeof Headers !== "undefined" && input instanceof Headers
    ? [...input.entries()]
    : Object.entries(input && typeof input === "object" ? input : {});
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || "").trim();
    const lower = name.toLowerCase();
    if (!name || lower === "host" || rawValue == null) continue;
    headers[name] = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  }

  const findHeader = (name) => Object.keys(headers).find((key) => key.toLowerCase() === name);
  if (!findHeader("accept-encoding")) headers["Accept-Encoding"] = "gzip, deflate, br";
  if (body && !findHeader("content-length")) headers["Content-Length"] = String(body.length);
  const contentLength = findHeader("content-length");
  if (body && contentLength && Number(headers[contentLength]) !== body.length) throw new Error("invalid_public_request_length");
  return headers;
}

function responseHeadersFromNode(source, decoded) {
  const headers = new Headers();
  for (const [rawName, rawValue] of Object.entries(source || {})) {
    const name = rawName.toLowerCase();
    if (rawValue == null || HOP_BY_HOP_HEADERS.has(name) || name === "set-cookie" || (decoded && ["content-encoding", "content-length"].includes(name))) continue;
    try { headers.set(name, Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue)); }
    catch { /* Ignore malformed upstream header values. */ }
  }
  return headers;
}

function decoderFor(encoding) {
  const normalized = String(encoding || "").trim().toLowerCase();
  if (!normalized || normalized === "identity") return null;
  if (normalized === "gzip" || normalized === "x-gzip") return zlib.createGunzip();
  if (normalized === "deflate") return zlib.createInflate();
  if (normalized === "br" && typeof zlib.createBrotliDecompress === "function") return zlib.createBrotliDecompress();
  throw new Error("unsupported_upstream_content_encoding");
}

function requestPinnedUrl(url, addressRecord, {
  method = "GET",
  headers = {},
  body,
  signal,
  timeoutMs = 5000,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
  requestImplementation,
} = {}) {
  const requestBody = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const responseLimit = Math.max(1, Math.min(10_000_000, Math.floor(Number(maxBytes) || DEFAULT_MAX_RESPONSE_BYTES)));
  if (requestBody && requestBody.length > MAX_REQUEST_BYTES) return Promise.reject(new Error("public_request_body_too_large"));
  const hostname = normalizeHostname(url.hostname);
  const client = requestImplementation || (url.protocol === "https:" ? https : http);
  const outboundHeaders = normalizeRequestHeaders(headers, requestBody);
  const requestOptions = {
    protocol: url.protocol,
    hostname,
    port: url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80),
    method: String(method || "GET").toUpperCase(),
    path: `${url.pathname || "/"}${url.search || ""}`,
    headers: outboundHeaders,
    lookup: createPinnedLookup(addressRecord),
  };
  if (url.protocol === "https:" && !net.isIP(hostname)) requestOptions.servername = hostname;
  if (signal) requestOptions.signal = signal;
  else requestOptions.signal = AbortSignal.timeout(timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let incoming;
    let decodedStream;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      try { decodedStream?.destroy(); } catch {}
      try { incoming?.destroy(); } catch {}
      try { request?.destroy(); } catch {}
      reject(error instanceof Error ? error : new Error("public_request_failed"));
    };

    try {
      request = client.request(requestOptions, (response) => {
        incoming = response;
        const status = Number(response.statusCode) || 502;
        const declaredLength = Number(response.headers?.["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > responseLimit) {
          finishError(new Error("upstream_response_too_large"));
          return;
        }

        let decoder;
        try { decoder = decoderFor(response.headers?.["content-encoding"]); }
        catch (error) { finishError(error); return; }
        decodedStream = decoder ? response.pipe(decoder) : response;
        let rawBytes = 0;
        let decodedBytes = 0;
        const chunks = [];
        if (decoder) response.on("data", (chunk) => {
          rawBytes += chunk.length;
          if (rawBytes > responseLimit) finishError(new Error("upstream_response_too_large"));
        });
        decodedStream.on("data", (chunk) => {
          decodedBytes += chunk.length;
          if (decodedBytes > responseLimit) { finishError(new Error("upstream_response_too_large")); return; }
          chunks.push(chunk);
        });
        response.on("aborted", () => finishError(new Error("upstream_response_aborted")));
        response.on("error", finishError);
        if (decoder) decodedStream.on("error", finishError);
        decodedStream.on("end", () => {
          if (settled) return;
          settled = true;
          try {
            const headersOut = responseHeadersFromNode(response.headers, Boolean(decoder));
            const bodyOut = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks, decodedBytes);
            resolve(new Response(bodyOut, { status, headers: headersOut }));
          } catch (error) { reject(error); }
        });
      });
      request.on("error", finishError);
      if (typeof request.setTimeout === "function") request.setTimeout(timeoutMs, () => finishError(new Error("public_request_timeout")));
      request.end(requestBody || undefined);
    } catch (error) {
      finishError(error);
    }
  });
}

function removeSensitiveHeaders(headers) {
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase())) delete result[name];
  }
  return result;
}

async function requestPublicUrl(value, options = {}) {
  const {
    protocols = ["https:", "http:"],
    allowCustomPort = false,
    maxRedirects: requestedRedirects = 0,
    resolver = dns.lookup,
    resolverTimeoutMs = 3000,
    requestImplementation,
    ...requestOptions
  } = options;
  const maxRedirects = Math.max(0, Math.min(MAX_REDIRECTS, Number(requestedRedirects) || 0));
  let url = parsePublicUrl(value, { protocols, allowCustomPort });
  let headers = requestOptions.headers || {};

  for (let redirectCount = 0; ; redirectCount += 1) {
    const address = await resolvePublicAddress(url.hostname, resolver, resolverTimeoutMs);
    const response = await requestPinnedUrl(url, address, { ...requestOptions, headers, requestImplementation });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount >= maxRedirects) return response;

    const nextUrl = parsePublicUrl(new URL(location, url).href, { protocols, allowCustomPort });
    if (nextUrl.origin !== url.origin) headers = removeSensitiveHeaders(headers);
    url = nextUrl;
  }
}

module.exports = {
  createPinnedLookup,
  parsePublicUrl,
  requestPublicUrl,
  resolvePublicAddress,
};
