/*
 * KAZER — Copyright © 2026 Jean V. / @jeanvicen · 0neajx · Klipza Studio.
 * Código proprietário. Consulte /LICENSE.md antes de reutilizar este arquivo.
 */
const crypto = require("node:crypto");

const rateBuckets = new Map();
const MAX_RATE_BUCKETS = 5000;
const DEFAULT_AUTH_TIMEOUT_MS = 5000;
// Fallback público do projeto Supabase; chaves privadas nunca entram no cliente.
const PUBLIC_SUPABASE_URL = "https://mqjunopzycdezzjmlhip.supabase.co";
const PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xanVub3B6eWNkZXp6am1saGlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mzg3NDksImV4cCI6MjEwMzQxNDc0OX0.Y_o2_QQhZzuCjvHdEfxaR5VrAxo7NFenPaDmdHN3bwM";

function sendJson(response, status, payload, extraHeaders = {}) {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  Object.entries(extraHeaders).forEach(([key, value]) => response.setHeader(key, String(value)));
  response.end(JSON.stringify(payload));
}

function header(request, name) {
  const value = request?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function getRequestHost(request) {
  return header(request, "host").split(",")[0].trim().toLowerCase();
}

function isSameOrigin(request) {
  const origin = header(request, "origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (!/^https?:$/.test(originUrl.protocol)) return false;
    const requestHost = getRequestHost(request);
    if (!requestHost) return false;

    const configuredOrigins = String(process.env.PUBLIC_APP_ORIGINS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const normalizedOrigin = originUrl.origin.toLowerCase();
    if (configuredOrigins.length && configuredOrigins.includes(normalizedOrigin)) return true;
    return originUrl.host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function hasSafeFetchMetadata(request) {
  const site = header(request, "sec-fetch-site").toLowerCase();
  return !site || site === "same-origin" || site === "same-site" || site === "none";
}

function getClientIp(request) {
  const forwarded = header(request, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 100) || "unknown";
  return (header(request, "x-real-ip") || "unknown").slice(0, 100);
}

function requestExceedsLimit(request, maximumBytes) {
  const length = Number.parseInt(header(request, "content-length"), 10);
  return Number.isFinite(length) && length > maximumBytes;
}

function getBearerToken(request) {
  const authorization = header(request, "authorization");
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/i);
  return match ? match[1] : null;
}

function supabaseBaseUrl() {
  const value = PUBLIC_SUPABASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function authenticateUser(request) {
  const token = getBearerToken(request);
  const baseUrl = supabaseBaseUrl();
  const anonKey = PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !baseUrl || !anonKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_AUTH_TIMEOUT_MS);
    const result = await fetch(`${baseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!result.ok) return null;
    const user = await result.json().catch(() => null);
    return user?.id ? { id: String(user.id) } : null;
  } catch {
    return null;
  }
}

function rateLimit(request, bucketName, { limit, windowMs = 60_000, identity = "" } = {}) {
  const now = Date.now();
  const key = `${bucketName}:${identity || getClientIp(request)}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;

  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    for (const [candidateKey, candidate] of rateBuckets) {
      if (now - candidate.startedAt >= windowMs) rateBuckets.delete(candidateKey);
    }
  }

  const remaining = Math.max(0, limit - bucket.count);
  const resetAt = Math.ceil((bucket.startedAt + windowMs) / 1000);
  return {
    allowed: bucket.count <= limit,
    remaining,
    resetAt,
    retryAfter: Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
  };
}

function applyRateLimit(response, result) {
  response.setHeader("X-RateLimit-Limit", result.limit ?? "");
  response.setHeader("X-RateLimit-Remaining", result.remaining);
  response.setHeader("X-RateLimit-Reset", result.resetAt);
  if (!result.allowed) response.setHeader("Retry-After", result.retryAfter);
}

function timingSafeEqualText(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (!actualBuffer.length || actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, "[segredo removido]")
    .replace(/\b(?:sk|gsk)_[A-Za-z0-9_-]{16,}\b/gi, "[chave removida]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[chave removida]")
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g, "[token removido]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, "Bearer [token removido]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[token removido]");
}

async function readTextWithLimit(response, maximumBytes = 1_000_000) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("upstream_response_too_large");
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error("upstream_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = {
  applyRateLimit,
  authenticateUser,
  getBearerToken,
  getClientIp,
  hasSafeFetchMetadata,
  isSameOrigin,
  rateLimit,
  readTextWithLimit,
  redactSensitiveText,
  requestExceedsLimit,
  sendJson,
  supabaseBaseUrl,
  timingSafeEqualText,
};
