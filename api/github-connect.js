const crypto = require("node:crypto");
const { requireUser, unauthorized } = require("./_kazer-data");
const { sendJson } = require("./_security");
const { getGitHubConfig, setCookie, signState } = require("./_github");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);

  const { clientId, redirectUri } = getGitHubConfig(request);
  if (!clientId) return sendJson(response, 503, { error: "GitHub OAuth ainda não foi configurado no servidor." });

  const state = signState({ userId: user.id, nonce: crypto.randomBytes(24).toString("base64url"), expiresAt: Date.now() + 10 * 60 * 1000 });
  setCookie(response, "kazer_github_oauth", state);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: "repo read:user user:email", state });
  return sendJson(response, 200, { url: `https://github.com/login/oauth/authorize?${params.toString()}` });
};
