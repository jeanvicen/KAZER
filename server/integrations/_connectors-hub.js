/*
 * KAZER — central de conectores.
 * Catálogo de serviços oficiais (OAuth ou token), conexão em poucos toques,
 * credenciais cifradas (AES-256-GCM) e uma ferramenta única para o agente
 * (connector_api) que só fala com o host oficial de cada serviço.
 *
 * Fluxo OAuth: POST /api/connect {action:"start", id} → URL oficial → a pessoa
 * autoriza → GET /api/connect/callback → token cifrado → /chat?connected=<id>.
 * Fluxo token: o cartão seguro envia a chave direto para POST /api/connect;
 * ela nunca passa pelo chat, pelo histórico nem pelo modelo.
 */
const crypto = require("node:crypto");
const { decryptSecret, encryptSecret, requireUser, supabaseRequest, unauthorized, badRequest } = require("../storage/_kazer-data");
const { readTextWithLimit, sendJson } = require("../security/_security");
const { parsePublicUrl, requestPublicUrl } = require("../security/_ssrf");
const { getGitHubConfig, readState, signState } = require("./_github");

const TABLE = "kazer_connections";
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/*
 * Cada item: api.base (host oficial fixo), auth (como o token vai no pedido),
 * tokenPage (onde a pessoa cria a chave), test (chamada de identidade) e,
 * quando houver, oauth (endpoints oficiais; ativado por variáveis de ambiente
 * KAZER_OAUTH_<ENV>_CLIENT_ID / _CLIENT_SECRET).
 */
const CATALOG = [
  { id: "github", name: "GitHub", category: "Código", builtin: "github", description: "Repositórios, issues e pull requests." },
  { id: "vercel", name: "Vercel", category: "Deploy", builtin: "vercel", description: "Projetos, deploys e logs." },
  { id: "gitlab", name: "GitLab", category: "Código", description: "Projetos, merge requests e pipelines.", api: { base: "https://gitlab.com/api/v4" }, auth: "bearer", tokenPage: "https://gitlab.com/-/user_settings/personal_access_tokens", test: { path: "/user", label: (d) => d.username }, oauth: { env: "GITLAB", authorize: "https://gitlab.com/oauth/authorize", token: "https://gitlab.com/oauth/token", scopes: "read_user api" } },
  { id: "bitbucket", name: "Bitbucket", category: "Código", description: "Repositórios e pull requests.", api: { base: "https://api.bitbucket.org/2.0" }, auth: "basic", fields: ["username", "password"], fieldLabels: { username: "Usuário", password: "App password" }, tokenPage: "https://bitbucket.org/account/settings/app-passwords/", test: { path: "/user", label: (d) => d.username } },
  { id: "notion", name: "Notion", category: "Documentos", description: "Páginas, bancos de dados e busca.", api: { base: "https://api.notion.com/v1", headers: { "Notion-Version": "2022-06-28" } }, auth: "bearer", tokenPage: "https://www.notion.so/profile/integrations", test: { path: "/users/me", label: (d) => d.name || d.bot?.owner?.user?.name }, oauth: { env: "NOTION", authorize: "https://api.notion.com/v1/oauth/authorize", token: "https://api.notion.com/v1/oauth/token", extra: { owner: "user" }, tokenAuth: "basic", tokenJson: true } },
  { id: "linear", name: "Linear", category: "Projetos", description: "Issues, ciclos e projetos.", api: { base: "https://api.linear.app", graphql: "/graphql" }, auth: "raw", tokenPage: "https://linear.app/settings/account/security", test: { method: "POST", path: "/graphql", body: { query: "{ viewer { name } }" }, label: (d) => d.data?.viewer?.name }, oauth: { env: "LINEAR", authorize: "https://linear.app/oauth/authorize", token: "https://api.linear.app/oauth/token", scopes: "read write" } },
  { id: "slack", name: "Slack", category: "Comunicação", description: "Canais, mensagens e busca.", api: { base: "https://slack.com/api" }, auth: "bearer", tokenPage: "https://api.slack.com/apps", test: { path: "/auth.test", label: (d) => d.ok ? `${d.user} · ${d.team}` : "" }, oauth: { env: "SLACK", authorize: "https://slack.com/oauth/v2/authorize", token: "https://slack.com/api/oauth.v2.access", userScopes: "channels:read channels:history search:read users:read chat:write", tokenPath: "authed_user.access_token" } },
  { id: "discord", name: "Discord (bot)", category: "Comunicação", description: "Servidores e canais do seu bot.", api: { base: "https://discord.com/api/v10" }, auth: "bot", tokenPage: "https://discord.com/developers/applications", test: { path: "/users/@me", label: (d) => d.username } },
  { id: "telegram", name: "Telegram (bot)", category: "Comunicação", description: "Mensagens do seu bot.", api: { base: "https://api.telegram.org" }, auth: "telegram", tokenPage: "https://t.me/BotFather", test: { path: "/getMe", label: (d) => d.result?.username } },
  { id: "whatsapp", name: "WhatsApp Cloud API", category: "Comunicação", description: "Mensagens pela API oficial da Meta.", api: { base: "https://graph.facebook.com/v21.0" }, auth: "bearer", tokenPage: "https://developers.facebook.com/apps", test: { path: "/me", label: (d) => d.name } },
  { id: "google", name: "Google (Gmail, Agenda, Drive)", category: "Produtividade", description: "Leitura de e-mails, agenda e arquivos.", api: { base: "https://www.googleapis.com" }, auth: "bearer", test: { path: "/oauth2/v3/userinfo", label: (d) => d.email }, oauth: { env: "GOOGLE", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scopes: "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly", extra: { access_type: "offline", prompt: "consent" } } },
  { id: "microsoft", name: "Microsoft 365 (Outlook, OneDrive, Teams)", category: "Produtividade", description: "E-mails, arquivos e calendário.", api: { base: "https://graph.microsoft.com/v1.0" }, auth: "bearer", test: { path: "/me", label: (d) => d.mail || d.userPrincipalName }, oauth: { env: "MICROSOFT", authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scopes: "offline_access User.Read Mail.Read Files.Read Calendars.Read" } },
  { id: "dropbox", name: "Dropbox", category: "Arquivos", description: "Arquivos e pastas.", api: { base: "https://api.dropboxapi.com/2" }, auth: "bearer", tokenPage: "https://www.dropbox.com/developers/apps", test: { method: "POST", path: "/users/get_current_account", label: (d) => d.email }, oauth: { env: "DROPBOX", authorize: "https://www.dropbox.com/oauth2/authorize", token: "https://api.dropboxapi.com/oauth2/token", extra: { token_access_type: "offline" } } },
  { id: "airtable", name: "Airtable", category: "Dados", description: "Bases, tabelas e registros.", api: { base: "https://api.airtable.com/v0" }, auth: "bearer", tokenPage: "https://airtable.com/create/tokens", test: { path: "/meta/whoami", label: (d) => d.email || d.id } },
  { id: "asana", name: "Asana", category: "Projetos", description: "Tarefas e projetos.", api: { base: "https://app.asana.com/api/1.0" }, auth: "bearer", tokenPage: "https://app.asana.com/0/my-apps", test: { path: "/users/me", label: (d) => d.data?.name }, oauth: { env: "ASANA", authorize: "https://app.asana.com/-/oauth_authorize", token: "https://app.asana.com/-/oauth_token" } },
  { id: "clickup", name: "ClickUp", category: "Projetos", description: "Tarefas, listas e espaços.", api: { base: "https://api.clickup.com/api/v2" }, auth: "raw", tokenPage: "https://app.clickup.com/settings/apps", test: { path: "/user", label: (d) => d.user?.username } },
  { id: "todoist", name: "Todoist", category: "Projetos", description: "Tarefas e projetos pessoais.", api: { base: "https://api.todoist.com/rest/v2" }, auth: "bearer", tokenPage: "https://app.todoist.com/app/settings/integrations/developer", test: { path: "/projects", label: () => "Todoist" } },
  { id: "atlassian", name: "Jira e Confluence", category: "Projetos", description: "Issues do Jira e páginas do Confluence.", site: { field: "site", suffix: ".atlassian.net", label: "Seu site (ex.: empresa.atlassian.net)" }, auth: "basic", fields: ["username", "password"], fieldLabels: { username: "E-mail", password: "API token" }, tokenPage: "https://id.atlassian.com/manage-profile/security/api-tokens", test: { path: "/rest/api/3/myself", label: (d) => d.emailAddress || d.displayName } },
  { id: "figma", name: "Figma", category: "Design", description: "Arquivos, frames e comentários.", api: { base: "https://api.figma.com/v1" }, auth: "header:X-Figma-Token", tokenPage: "https://www.figma.com/settings", test: { path: "/me", label: (d) => d.email || d.handle } },
  { id: "supabase", name: "Supabase", category: "Dados", description: "Projetos, bancos e funções.", api: { base: "https://api.supabase.com/v1" }, auth: "bearer", tokenPage: "https://supabase.com/dashboard/account/tokens", test: { path: "/projects", label: () => "Supabase" } },
  { id: "neon", name: "Neon", category: "Dados", description: "Postgres serverless.", api: { base: "https://console.neon.tech/api/v2" }, auth: "bearer", tokenPage: "https://console.neon.tech/app/settings/api-keys", test: { path: "/users/me", label: (d) => d.email } },
  { id: "netlify", name: "Netlify", category: "Deploy", description: "Sites e deploys.", api: { base: "https://api.netlify.com/api/v1" }, auth: "bearer", tokenPage: "https://app.netlify.com/user/applications#personal-access-tokens", test: { path: "/user", label: (d) => d.email } },
  { id: "cloudflare", name: "Cloudflare", category: "Deploy", description: "DNS, Workers e Pages.", api: { base: "https://api.cloudflare.com/client/v4" }, auth: "bearer", tokenPage: "https://dash.cloudflare.com/profile/api-tokens", test: { path: "/user/tokens/verify", label: (d) => (d.success ? "Token ativo" : "") } },
  { id: "render", name: "Render", category: "Deploy", description: "Serviços e deploys.", api: { base: "https://api.render.com/v1" }, auth: "bearer", tokenPage: "https://dashboard.render.com/u/settings#api-keys", test: { path: "/owners", label: (d) => d?.[0]?.owner?.email || "Render" } },
  { id: "railway", name: "Railway", category: "Deploy", description: "Projetos e serviços.", api: { base: "https://backboard.railway.com", graphql: "/graphql/v2" }, auth: "bearer", tokenPage: "https://railway.com/account/tokens", test: { method: "POST", path: "/graphql/v2", body: { query: "{ me { email } }" }, label: (d) => d.data?.me?.email } },
  { id: "digitalocean", name: "DigitalOcean", category: "Deploy", description: "Droplets, apps e bancos.", api: { base: "https://api.digitalocean.com/v2" }, auth: "bearer", tokenPage: "https://cloud.digitalocean.com/account/api/tokens", test: { path: "/account", label: (d) => d.account?.email } },
  { id: "sentry", name: "Sentry", category: "Monitoramento", description: "Erros e issues de produção.", api: { base: "https://sentry.io/api/0" }, auth: "bearer", tokenPage: "https://sentry.io/settings/account/api/auth-tokens/", test: { path: "/organizations/", label: (d) => d?.[0]?.name || "Sentry" } },
  { id: "stripe", name: "Stripe", category: "Pagamentos", description: "Pagamentos, clientes e assinaturas.", api: { base: "https://api.stripe.com/v1" }, auth: "bearer", tokenPage: "https://dashboard.stripe.com/apikeys", test: { path: "/balance", label: (d) => (d.object === "balance" ? "Conta Stripe" : "") } },
  { id: "mercadopago", name: "Mercado Pago", category: "Pagamentos", description: "Pagamentos e PIX.", api: { base: "https://api.mercadopago.com" }, auth: "bearer", tokenPage: "https://www.mercadopago.com.br/developers/panel/app", test: { path: "/users/me", label: (d) => d.email || d.nickname } },
  { id: "hubspot", name: "HubSpot", category: "Vendas", description: "Contatos, empresas e negócios.", api: { base: "https://api.hubapi.com" }, auth: "bearer", tokenPage: "https://app.hubspot.com/", test: { path: "/crm/v3/objects/contacts?limit=1", label: () => "HubSpot" } },
  { id: "calendly", name: "Calendly", category: "Produtividade", description: "Agendamentos e eventos.", api: { base: "https://api.calendly.com" }, auth: "bearer", tokenPage: "https://calendly.com/integrations/api_webhooks", test: { path: "/users/me", label: (d) => d.resource?.email } },
  { id: "typeform", name: "Typeform", category: "Dados", description: "Formulários e respostas.", api: { base: "https://api.typeform.com" }, auth: "bearer", tokenPage: "https://admin.typeform.com/user/tokens", test: { path: "/me", label: (d) => d.email } },
  { id: "sendgrid", name: "SendGrid", category: "E-mail", description: "Envio de e-mails.", api: { base: "https://api.sendgrid.com/v3" }, auth: "bearer", tokenPage: "https://app.sendgrid.com/settings/api_keys", test: { path: "/user/profile", label: (d) => d.first_name || "SendGrid" } },
  { id: "resend", name: "Resend", category: "E-mail", description: "Envio de e-mails para devs.", api: { base: "https://api.resend.com" }, auth: "bearer", tokenPage: "https://resend.com/api-keys", test: { path: "/domains", label: () => "Resend" } },
  { id: "brevo", name: "Brevo", category: "E-mail", description: "E-mail marketing e transacional.", api: { base: "https://api.brevo.com/v3" }, auth: "header:api-key", tokenPage: "https://app.brevo.com/settings/keys/api", test: { path: "/account", label: (d) => d.email } },
  { id: "twilio", name: "Twilio", category: "Comunicação", description: "SMS e voz.", api: { base: "https://api.twilio.com/2010-04-01" }, auth: "basic", fields: ["username", "password"], fieldLabels: { username: "Account SID", password: "Auth token" }, tokenPage: "https://console.twilio.com/", test: { path: "/Accounts.json", label: (d) => d.accounts?.[0]?.friendly_name } },
  { id: "spotify", name: "Spotify", category: "Mídia", description: "Playlists e músicas.", api: { base: "https://api.spotify.com/v1" }, auth: "bearer", test: { path: "/me", label: (d) => d.display_name || d.id }, oauth: { env: "SPOTIFY", authorize: "https://accounts.spotify.com/authorize", token: "https://accounts.spotify.com/api/token", scopes: "user-read-email playlist-read-private user-library-read", tokenAuth: "basic" } },
  { id: "x", name: "X (Twitter)", category: "Redes sociais", description: "Posts e perfil.", api: { base: "https://api.x.com/2" }, auth: "bearer", test: { path: "/users/me", label: (d) => d.data?.username }, oauth: { env: "X", authorize: "https://x.com/i/oauth2/authorize", token: "https://api.x.com/2/oauth2/token", scopes: "tweet.read users.read offline.access", pkce: true, tokenAuth: "basic" } },
  { id: "reddit", name: "Reddit", category: "Redes sociais", description: "Perfil, posts e comunidades.", api: { base: "https://oauth.reddit.com" }, auth: "bearer", test: { path: "/api/v1/me", label: (d) => d.name }, oauth: { env: "REDDIT", authorize: "https://www.reddit.com/api/v1/authorize", token: "https://www.reddit.com/api/v1/access_token", scopes: "identity read mysubreddits", extra: { duration: "permanent" }, tokenAuth: "basic" } },
  { id: "zoom", name: "Zoom", category: "Comunicação", description: "Reuniões e gravações.", api: { base: "https://api.zoom.us/v2" }, auth: "bearer", test: { path: "/users/me", label: (d) => d.email }, oauth: { env: "ZOOM", authorize: "https://zoom.us/oauth/authorize", token: "https://zoom.us/oauth/token", tokenAuth: "basic" } },
  { id: "huggingface", name: "Hugging Face", category: "IA", description: "Modelos, datasets e Spaces.", api: { base: "https://huggingface.co/api" }, auth: "bearer", tokenPage: "https://huggingface.co/settings/tokens", test: { path: "/whoami-v2", label: (d) => d.name } },
  { id: "replicate", name: "Replicate", category: "IA", description: "Rodar modelos de imagem, vídeo e áudio.", api: { base: "https://api.replicate.com/v1" }, auth: "bearer", tokenPage: "https://replicate.com/account/api-tokens", test: { path: "/account", label: (d) => d.username } },
  { id: "openai", name: "OpenAI (API)", category: "IA", description: "Imagens, áudio e modelos da OpenAI.", api: { base: "https://api.openai.com/v1" }, auth: "bearer", tokenPage: "https://platform.openai.com/api-keys", test: { path: "/models", label: () => "OpenAI" } },
  { id: "postman", name: "Postman", category: "Código", description: "Coleções e ambientes.", api: { base: "https://api.getpostman.com" }, auth: "header:X-Api-Key", tokenPage: "https://go.postman.co/settings/me/api-keys", test: { path: "/me", label: (d) => d.user?.username } },
];
const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

/* ── Utilidades ──────────────────────────────────────────────────────── */
function oauthCredentials(item) {
  if (!item?.oauth) return null;
  const clientId = String(process.env[`KAZER_OAUTH_${item.oauth.env}_CLIENT_ID`] || "").trim();
  const clientSecret = String(process.env[`KAZER_OAUTH_${item.oauth.env}_CLIENT_SECRET`] || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function callbackUri(request) {
  return `${getGitHubConfig(request).appOrigin}/api/connect/callback`;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

function readCookie(request, name) {
  const match = String(request.headers?.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function cleanText(value, max = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

// Base da API: fixa no catálogo; Jira/Confluence usam o site da pessoa (*.atlassian.net);
// conectores personalizados guardam uma URL HTTPS pública validada.
function apiBase(item, secret) {
  if (item?.site) {
    const host = cleanText(secret?.site, 120).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9-]+\.atlassian\.net$/.test(host)) throw new Error("site_invalid");
    return `https://${host}`;
  }
  if (item?.api?.base) return item.api.base;
  if (secret?.baseUrl) return parsePublicUrl(secret.baseUrl, { protocols: ["https:"] }).toString().replace(/\/$/, "");
  throw new Error("connector_base_missing");
}

function authHeaders(item, secret) {
  const mode = secret?.auth || item?.auth || "bearer";
  const token = secret?.token || "";
  if (mode === "bearer") return bearer(token);
  if (mode === "raw") return { Authorization: token };
  if (mode === "bot") return { Authorization: `Bot ${token}` };
  if (mode === "basic") return { Authorization: `Basic ${Buffer.from(`${secret?.username || ""}:${secret?.password || ""}`).toString("base64")}` };
  if (mode.startsWith("header:")) return { [mode.slice(7)]: token };
  return {};
}

function buildUrl(item, secret, path) {
  const base = apiBase(item, secret);
  const cleanPath = `/${String(path || "").replace(/^\/+/, "")}`;
  if (/\.\.|\/\/|[\s\\]/.test(cleanPath)) throw new Error("path_invalid");
  // Telegram coloca o token no caminho (padrão oficial da Bot API).
  const prefix = (secret?.auth || item?.auth) === "telegram" ? `/bot${secret?.token || ""}` : "";
  const url = new URL(`${base}${prefix}${cleanPath}`);
  if (url.origin !== new URL(base).origin) throw new Error("path_invalid");
  return url;
}

async function callApi(item, secret, { method = "GET", path = "/", query = null, body = null } = {}) {
  const url = buildUrl(item, secret, path);
  if (query && typeof query === "object") Object.entries(query).slice(0, 20).forEach(([key, value]) => url.searchParams.set(cleanText(key, 60), cleanText(value, 300)));
  const headers = { Accept: "application/json", ...(item?.api?.headers || {}), ...authHeaders(item, secret), ...(body ? { "Content-Type": "application/json" } : {}) };
  const response = await requestPublicUrl(url.toString(), {
    protocols: ["https:"],
    maxRedirects: 0,
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    maxBytes: 1024 * 1024,
    timeoutMs: 12_000,
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await readTextWithLimit(response, 1024 * 1024);
  let data = null;
  try { data = JSON.parse(raw || "null"); } catch { data = raw.slice(0, 4000); }
  return { ok: response.ok, status: response.status, data };
}

async function identify(item, secret) {
  if (!item?.test) return { ok: true, label: item?.name || "Conectado" };
  const result = await callApi(item, secret, item.test);
  if (!result.ok) return { ok: false, status: result.status };
  let label = "";
  try { label = cleanText(item.test.label?.(result.data || {}) || "", 120); } catch { label = ""; }
  return { ok: true, label: label || item.name };
}

async function listConnections(userId) {
  const rows = await supabaseRequest(TABLE, { query: { select: "provider,account_label,auth_kind,base_url,created_at,updated_at", user_id: `eq.${userId}`, order: "created_at.asc" } });
  return Array.isArray(rows) ? rows : [];
}

async function saveConnection(userId, provider, { label, authKind, secret, baseUrl = null }) {
  const row = { user_id: userId, provider, account_label: cleanText(label, 160) || provider, auth_kind: authKind, base_url: baseUrl, secret_encrypted: encryptSecret(JSON.stringify(secret)) };
  await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${userId}`, provider: `eq.${provider}` } });
  const rows = await supabaseRequest(TABLE, { method: "POST", body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function loadSecret(userId, provider) {
  const rows = await supabaseRequest(TABLE, { query: { select: "*", user_id: `eq.${userId}`, provider: `eq.${provider}`, limit: 1 } });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  let secret = null;
  try { secret = JSON.parse(decryptSecret(row.secret_encrypted) || "null"); } catch { secret = null; }
  return secret ? { row, secret } : null;
}

function customItem(provider, secret) {
  return { id: provider, name: secret?.name || provider.replace(/^custom:/, ""), auth: secret?.auth || "bearer", api: null };
}

function itemFor(provider, secret) {
  return BY_ID.get(provider) || (provider.startsWith("custom:") ? customItem(provider, secret) : null);
}

/* ── OAuth: renovação de token expirado ──────────────────────────────── */
async function exchangeToken(item, params) {
  const creds = oauthCredentials(item);
  if (!creds) throw new Error("oauth_not_configured");
  const form = { ...params, ...(item.oauth.tokenAuth === "basic" ? {} : { client_id: creds.clientId, client_secret: creds.clientSecret }) };
  const headers = { Accept: "application/json", ...(item.oauth.tokenAuth === "basic" ? { Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}` } : {}) };
  const response = await fetch(item.oauth.token, {
    method: "POST",
    headers: { ...headers, "Content-Type": item.oauth.tokenJson ? "application/json" : "application/x-www-form-urlencoded" },
    body: item.oauth.tokenJson ? JSON.stringify(form) : new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);
  const token = item.oauth.tokenPath ? item.oauth.tokenPath.split(".").reduce((value, key) => value?.[key], data) : data?.access_token;
  if (!response.ok || !token) throw new Error("oauth_exchange_failed");
  return { token, refreshToken: data.refresh_token || null, expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null };
}

async function freshSecret(userId, provider, loaded) {
  const item = itemFor(provider, loaded.secret);
  const secret = loaded.secret;
  if (!secret.refreshToken || !secret.expiresAt || secret.expiresAt - Date.now() > 60_000 || !item?.oauth) return secret;
  try {
    const next = await exchangeToken(item, { grant_type: "refresh_token", refresh_token: secret.refreshToken });
    const updated = { ...secret, token: next.token, refreshToken: next.refreshToken || secret.refreshToken, expiresAt: next.expiresAt };
    await supabaseRequest(TABLE, { method: "PATCH", query: { user_id: `eq.${userId}`, provider: `eq.${provider}` }, body: { secret_encrypted: encryptSecret(JSON.stringify(updated)) } });
    return updated;
  } catch { return secret; }
}

/* ── Para o cliente ──────────────────────────────────────────────────── */
function catalogForClient(connections) {
  const connected = new Map(connections.map((row) => [row.provider, row]));
  const items = CATALOG.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    builtin: item.builtin || null,
    oauth: Boolean(oauthCredentials(item)),
    token: Boolean(!item.builtin && (item.tokenPage || item.fields || item.site)),
    tokenPage: item.tokenPage || null,
    fields: item.fields ? item.fields.map((name) => ({ name, label: item.fieldLabels?.[name] || name, secret: name === "password" })) : [{ name: "token", label: "Chave / token de acesso", secret: true }],
    site: item.site ? { label: item.site.label, suffix: item.site.suffix } : null,
    connected: connected.has(item.id),
    account: connected.get(item.id)?.account_label || null,
  }));
  const custom = connections.filter((row) => row.provider.startsWith("custom:")).map((row) => ({ id: row.provider, name: row.account_label, category: "Personalizado", description: row.base_url || "", connected: true, account: row.base_url || null, custom: true }));
  return [...items, ...custom];
}

/* ── Handler HTTP: /api/connect ──────────────────────────────────────── */
function redirect(response, location, cookie) {
  response.statusCode = 302;
  response.setHeader("Location", location);
  if (cookie) response.setHeader("Set-Cookie", cookie);
  response.end();
}

async function handleCallback(request, response) {
  const origin = getGitHubConfig(request).appOrigin;
  const clearCookie = `kazer_connect_pkce=; Max-Age=0; Path=/api; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  const back = (status, id = "") => new URL(`/chat?connector=${encodeURIComponent(status)}${id ? `&id=${encodeURIComponent(id)}` : ""}`, origin).toString();
  const payload = readState(String(request.query?.state || ""));
  const code = String(request.query?.code || "");
  const item = payload ? BY_ID.get(payload.provider) : null;
  if (!payload || !item?.oauth || !code) return redirect(response, back("error"), clearCookie);
  try {
    let verifier = "";
    if (item.oauth.pkce) {
      try { verifier = decryptSecret(readCookie(request, "kazer_connect_pkce")) || ""; } catch { verifier = ""; }
      if (!verifier) throw new Error("pkce_missing");
    }
    const result = await exchangeToken(item, { grant_type: "authorization_code", code, redirect_uri: callbackUri(request), ...(verifier ? { code_verifier: verifier } : {}) });
    const secret = { token: result.token, refreshToken: result.refreshToken, expiresAt: result.expiresAt, auth: "bearer" };
    const who = await identify(item, secret).catch(() => ({ ok: true, label: item.name }));
    await saveConnection(payload.userId, item.id, { label: who.label || item.name, authKind: "oauth", secret });
    return redirect(response, back("connected", item.id), clearCookie);
  } catch (error) {
    console.error("Connector OAuth callback failed", item.id, error?.message || "unknown");
    return redirect(response, back("error", item.id), clearCookie);
  }
}

async function handler(request, response) {
  const action = String(request.query?.action || "").toLowerCase();
  if (action === "callback" && request.method === "GET") return handleCallback(request, response);
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  try {
    if (request.method === "GET") {
      const connections = await listConnections(user.id);
      return sendJson(response, 200, { connectors: catalogForClient(connections) });
    }
    const body = parseBody(request);
    if (!body) return badRequest(response, "JSON inválido.");
    const id = cleanText(body.id, 120);
    if (request.method === "DELETE") {
      await supabaseRequest(TABLE, { method: "DELETE", query: { user_id: `eq.${user.id}`, provider: `eq.${id}` } });
      return sendJson(response, 200, { success: true });
    }

    // 1) OAuth: devolve a URL oficial de autorização.
    if (body.action === "start") {
      const item = BY_ID.get(id);
      const creds = oauthCredentials(item);
      if (!item || !creds) return badRequest(response, "Este serviço não tem login oficial configurado; use a chave pelo cartão seguro.");
      const state = signState({ userId: user.id, provider: item.id, nonce: crypto.randomBytes(18).toString("base64url"), expiresAt: Date.now() + 10 * 60 * 1000 });
      const params = new URLSearchParams({ client_id: creds.clientId, redirect_uri: callbackUri(request), response_type: "code", state, ...(item.oauth.scopes ? { scope: item.oauth.scopes } : {}), ...(item.oauth.userScopes ? { user_scope: item.oauth.userScopes } : {}), ...(item.oauth.extra || {}) });
      if (item.oauth.pkce) {
        const verifier = crypto.randomBytes(48).toString("base64url");
        params.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
        params.set("code_challenge_method", "S256");
        response.setHeader("Set-Cookie", `kazer_connect_pkce=${encodeURIComponent(encryptSecret(verifier))}; Max-Age=600; Path=/api; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
      }
      return sendJson(response, 200, { url: `${item.oauth.authorize}?${params.toString()}` });
    }

    // 2) Conector personalizado: URL HTTPS pública + chave, confirmada pela pessoa.
    if (body.action === "custom") {
      let base;
      try { base = parsePublicUrl(cleanText(body.baseUrl, 400), { protocols: ["https:"] }); } catch { return badRequest(response, "Use uma URL HTTPS pública da API."); }
      const auth = ["bearer", "raw"].includes(body.auth) ? body.auth : String(body.auth || "").startsWith("header:") && /^header:[A-Za-z0-9-]{2,40}$/.test(body.auth) ? body.auth : "bearer";
      const token = String(body.fields?.token || "").trim();
      if (!/^[\x21-\x7e]{8,600}$/.test(token)) return badRequest(response, "Chave inválida.");
      const name = cleanText(body.name, 60) || base.hostname;
      const provider = `custom:${base.hostname}`.slice(0, 120);
      const secret = { token, auth, baseUrl: base.toString().replace(/\/$/, ""), name };
      await saveConnection(user.id, provider, { label: name, authKind: "custom", secret, baseUrl: secret.baseUrl });
      return sendJson(response, 201, { connected: true, id: provider, account: name });
    }

    // 3) Chave/token pelo cartão seguro: valida no serviço oficial antes de salvar.
    const item = BY_ID.get(id);
    if (!item || item.builtin) return badRequest(response, "Conector desconhecido.");
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const secret = { auth: item.auth };
    if (item.fields) item.fields.forEach((name) => { secret[name] = String(fields[name] || "").trim().slice(0, 600); });
    else secret.token = String(fields.token || "").trim();
    if (item.site) secret.site = cleanText(fields.site, 120);
    const values = item.fields ? item.fields.map((name) => secret[name]) : [secret.token];
    if (values.some((value) => !/^[\x20-\x7e]{3,600}$/.test(value || ""))) return badRequest(response, "Preencha todos os campos do cartão seguro.");
    let who;
    try { who = await identify(item, secret); } catch { return badRequest(response, `Não consegui falar com ${item.name}. Confira os dados.`); }
    if (!who.ok) return badRequest(response, `${item.name} recusou a credencial (HTTP ${who.status}).`);
    await saveConnection(user.id, item.id, { label: who.label, authKind: "token", secret, baseUrl: item.site ? apiBase(item, secret) : null });
    return sendJson(response, 201, { connected: true, id: item.id, account: who.label });
  } catch (error) {
    console.error("Connector hub error", error?.message || "unknown");
    return sendJson(response, 503, { error: "Não foi possível concluir a conexão agora." });
  }
}

/* ── Agente: ferramenta connector_api ────────────────────────────────── */
async function createConnectorSession(userId) {
  const connections = await listConnections(userId);
  if (!connections.length) return null;
  return { userId, connections };
}

function connectorToolDefinitions(session, { computer = false } = {}) {
  if (!session?.connections?.length) return [];
  const ids = session.connections.map((row) => row.provider);
  return [{
    type: "function",
    function: {
      name: "connector_api",
      description: `Chama a API oficial de um serviço que a pessoa conectou ao KAZER (${ids.join(", ")}). O host é fixo por serviço; informe só o caminho (ex.: /users/me). ${computer ? "Modo Computer: leitura e escrita permitidas, sempre dentro do que a pessoa pediu." : "Chat normal: somente leitura (GET, ou consultas GraphQL sem mutation)."} Nunca peça ou mostre senhas e tokens.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          connector: { type: "string", enum: ids },
          method: { type: "string", enum: computer ? ["GET", "POST", "PUT", "PATCH", "DELETE"] : ["GET", "POST"] },
          path: { type: "string", maxLength: 400 },
          query: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "object" },
        },
        required: ["connector", "path"],
      },
    },
  }];
}

function isReadOnlyCall(item, method, path, body) {
  if (method === "GET") return true;
  if (method !== "POST") return false;
  // Consultas GraphQL de leitura e alguns endpoints RPC de leitura (POST por design).
  const graphql = item?.api?.graphql && `/${String(path).replace(/^\/+/, "")}` === item.api.graphql;
  if (graphql) return typeof body?.query === "string" && !/\bmutation\b/i.test(body.query);
  return Boolean(item?.test?.method === "POST" && `/${String(path).replace(/^\/+/, "")}` === item.test.path);
}

async function executeConnectorTool(session, args, { computer = false } = {}) {
  const provider = cleanText(args?.connector, 120);
  if (!session?.connections?.some((row) => row.provider === provider)) return { error: "connector_not_connected" };
  const loaded = await loadSecret(session.userId, provider);
  if (!loaded) return { error: "connector_not_connected" };
  const secret = await freshSecret(session.userId, provider, loaded);
  const item = itemFor(provider, secret);
  const method = String(args?.method || "GET").toUpperCase();
  if (!computer && !isReadOnlyCall(item, method, args?.path, args?.body)) return { error: "write_requires_computer_mode", hint: "Explique que o modo Computer (Pro) faz essa alteração." };
  const result = await callApi(item, secret, { method, path: args?.path, query: args?.query, body: args?.body && typeof args.body === "object" ? args.body : null });
  return { status: result.status, ok: result.ok, data: result.data };
}

function connectorsInstruction(session) {
  const connected = (session?.connections || []).map((row) => `${row.provider} (${row.account_label})`);
  const catalog = CATALOG.map((item) => item.id).join(", ");
  return [
    "CONECTORES: o KAZER conecta serviços oficiais em poucos toques.",
    connected.length ? `Conectados agora: ${connected.join("; ")}. Use a ferramenta connector_api para consultá-los.` : "Nenhum serviço conectado além de GitHub/Vercel (se houver).",
    `Catálogo pronto: ${catalog}.`,
    "Quando a pessoa pedir para conectar algo: se estiver no catálogo, responda curto e inclua um bloco ```kazer-connect com JSON {\"id\":\"<id>\"}. O cartão leva ao login oficial ou ao cartão seguro.",
    "Se não estiver no catálogo, use o conhecimento/pesquisa para achar a documentação OFICIAL da API do serviço; se ele aceitar chave de API, inclua ```kazer-connect com {\"custom\":true,\"name\":\"<Nome>\",\"baseUrl\":\"https://<host oficial da API>\",\"auth\":\"bearer\"|\"raw\"|\"header:<Nome-Do-Header>\",\"tokenPage\":\"https://<página oficial para criar a chave>\"}. Use apenas domínios oficiais do próprio serviço.",
    "SEGURANÇA: nunca peça senha, token, chave ou usuário em texto no chat. Sempre que precisar de uma credencial, use o bloco kazer-connect (que abre o cartão seguro). Se a pessoa colar um segredo no chat, oriente a usar o cartão seguro e a revogar a chave exposta.",
  ].join("\n");
}

module.exports = {
  CATALOG,
  apiBase,
  authHeaders,
  buildUrl,
  catalogForClient,
  connectorToolDefinitions,
  connectorsInstruction,
  createConnectorSession,
  executeConnectorTool,
  handler,
  isReadOnlyCall,
};
