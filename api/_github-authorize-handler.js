const crypto = require("node:crypto");
const { requireUser } = require("./_kazer-data");
const { getGitHubConfig, setCookie, signState } = require("./_github");

function tokenFromBody(request) {
  const body = request?.body;
  if (!body || typeof body !== "object") return "";
  return String(body.access_token || body.accessToken || "").trim();
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Método não permitido.");
  }

  const token = tokenFromBody(request);
  if (!token) {
    response.status(400).setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Sessão inválida ou expirada.");
  }

  const authenticatedRequest = {
    ...request,
    headers: { ...(request.headers || {}), authorization: `Bearer ${token}` },
  };
  const user = await requireUser(authenticatedRequest);
  if (!user) {
    response.status(401).setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Sessão inválida ou expirada.");
  }

  const { clientId, redirectUri } = getGitHubConfig(request);
  if (!clientId) {
    response.status(503).setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("GitHub OAuth ainda não foi configurado no servidor.");
  }

  const state = signState({ userId: user.id, nonce: crypto.randomBytes(24).toString("base64url"), expiresAt: Date.now() + 10 * 60 * 1000 });
  setCookie(response, "kazer_github_oauth", state);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: "repo read:user user:email", state });
  response.status(302);
  response.setHeader("Location", `https://github.com/login/oauth/authorize?${params.toString()}`);
  return response.end();
};
