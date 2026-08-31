const crypto = require("node:crypto");
const { getBearerToken, supabaseBaseUrl } = require("./_security");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
const TOKEN_TABLE = "kazer_google_drive_connections";

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI,
    encryptionKey: process.env.GOOGLE_DRIVE_TOKEN_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}
function assertConfig() {
  const value = config();
  if (!value.clientId || !value.clientSecret || !value.redirectUri || !value.encryptionKey || !value.serviceRoleKey) throw new Error("google_drive_not_configured");
  return value;
}
function keyBytes(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(assertConfig().encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
function decrypt(value) {
  const [iv, tag, encrypted] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(assertConfig().encryptionKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
function signedState(userId) {
  const nonce = crypto.randomBytes(18).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ userId, nonce, exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", assertConfig().encryptionKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyState(value) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) throw new Error("oauth_state_invalid");
  const expected = crypto.createHmac("sha256", assertConfig().encryptionKey).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("oauth_state_invalid");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.userId || parsed.exp < Date.now()) throw new Error("oauth_state_expired");
  return parsed;
}
function authorizationUrl(userId) {
  const value = assertConfig();
  const params = new URLSearchParams({ client_id: value.clientId, redirect_uri: value.redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: DRIVE_SCOPE, state: signedState(userId) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
async function exchangeCode(code) {
  const value = assertConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: value.clientId, client_secret: value.clientSecret, redirect_uri: value.redirectUri, grant_type: "authorization_code" }), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("google_oauth_exchange_failed");
  return data;
}
function dbHeaders() {
  const value = assertConfig();
  return { apikey: value.serviceRoleKey, Authorization: `Bearer ${value.serviceRoleKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" };
}
async function dbRequest(path, options = {}) {
  const base = supabaseBaseUrl();
  if (!base) throw new Error("supabase_unavailable");
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { ...dbHeaders(), ...(options.headers || {}) }, signal: AbortSignal.timeout(7000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "google_drive_storage_failed");
  return data;
}
async function saveConnection(userId, token) {
  return dbRequest(TOKEN_TABLE, { method: "POST", body: JSON.stringify({ user_id: userId, access_token: encrypt(token.access_token), refresh_token: token.refresh_token ? encrypt(token.refresh_token) : null, expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), scope: DRIVE_SCOPE, updated_at: new Date().toISOString() }) });
}
async function deleteConnection(userId) { return dbRequest(`${TOKEN_TABLE}?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" }); }
async function getConnection(userId) {
  const rows = await dbRequest(`${TOKEN_TABLE}?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { method: "GET" });
  return rows?.[0] || null;
}
async function refreshAccessToken(connection) {
  const value = assertConfig();
  if (connection.expires_at && new Date(connection.expires_at).getTime() > Date.now() + 60000) return decrypt(connection.access_token);
  if (!connection.refresh_token) throw new Error("google_drive_reconnect_required");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: value.clientId, client_secret: value.clientSecret, refresh_token: decrypt(connection.refresh_token), grant_type: "refresh_token" }), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("google_drive_refresh_failed");
  await dbRequest(`${TOKEN_TABLE}?user_id=eq.${encodeURIComponent(connection.user_id)}`, { method: "PATCH", body: JSON.stringify({ access_token: encrypt(data.access_token), expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }) });
  return data.access_token;
}
async function accessTokenForRequest(request, userId) {
  const token = getBearerToken(request);
  if (!token || !userId) throw new Error("not_authenticated");
  const connection = await getConnection(userId);
  if (!connection) throw new Error("google_drive_not_connected");
  return refreshAccessToken({ ...connection, user_id: userId });
}
async function driveFetch(accessToken, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(data?.error?.message || "google_drive_request_failed"); error.status = response.status; throw error; }
  return data;
}
module.exports = { accessTokenForRequest, authorizationUrl, deleteConnection, driveFetch, exchangeCode, getConnection, getBearerToken, saveConnection, verifyState };

