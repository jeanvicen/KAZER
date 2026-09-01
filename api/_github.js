const crypto = require("node:crypto");
const { decryptSecret, encryptSecret, safeJson, supabaseRequest } = require("./_kazer-data");

function getGitHubConfig(request) {
  const clientId = String(process.env.GITHUB_CLIENT_ID || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GITHUB_CLIENT_SECRET || "").trim();
  const configuredOrigin = String(process.env.PUBLIC_APP_ORIGINS || "").split(",")[0].trim().replace(/\/$/, "");
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(request?.headers?.host || "").split(",")[0].trim();
  const origin = configuredOrigin || `${forwardedProto === "http" ? "http" : "https"}://${host}`;
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/github-callback`,
  };
}

function stateKey() {
  return crypto.createHash("sha256").update(String(process.env.GITHUB_OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "kazer-state"), "utf8").digest();
}

function signState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", stateKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readState(value) {
  if (!value || typeof value !== "string") return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", stateKey()).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.userId || !payload?.nonce || Number(payload.expiresAt) < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function setCookie(response, name, value, maxAge = 600) {
  response.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

function clearCookie(response, name) {
  response.setHeader("Set-Cookie", `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

async function githubFetch(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "github_request_failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getConnection(userId) {
  const rows = await supabaseRequest("kazer_github_connections", {
    query: { select: "user_id,github_user_id,login,display_name,avatar_url,access_token_encrypted,scope,created_at,updated_at", user_id: `eq.${userId}`, limit: 1 },
  });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function connectionForClient(row) {
  return row ? {
    connected: true,
    login: row.login,
    displayName: row.display_name || row.login,
    avatarUrl: row.avatar_url || null,
    scope: row.scope || "",
    connectedAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  } : { connected: false };
}

function decodeToken(row) {
  const value = decryptSecret(row?.access_token_encrypted);
  return typeof value === "string" ? value : safeJson(value, "");
}

function repoForClient(repo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login || repo.full_name?.split("/")[0] || "",
    description: repo.description || "",
    private: Boolean(repo.private),
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch || "main",
    language: repo.language || null,
    updatedAt: repo.updated_at || null,
  };
}

module.exports = {
  clearCookie,
  connectionForClient,
  decodeToken,
  encryptSecret,
  getConnection,
  getGitHubConfig,
  githubFetch,
  readState,
  repoForClient,
  setCookie,
  signState,
};
