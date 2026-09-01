const { clearCookie, encryptSecret, getGitHubConfig, githubFetch, readState, setCookie } = require("./_github");
const { supabaseRequest } = require("./_kazer-data");

function cookies(request) {
  return Object.fromEntries(String(request.headers?.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function redirect(response, location, cookieHeader) {
  response.statusCode = 302;
  response.setHeader("Location", location);
  if (cookieHeader) response.setHeader("Set-Cookie", cookieHeader);
  response.end();
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET");
    response.end("Método não permitido.");
    return;
  }

  const queryState = String(request.query?.state || "");
  const code = String(request.query?.code || "");
  const stored = cookies(request).kazer_github_oauth;
  const payload = readState(stored);
  const stateMatches = Boolean(payload && queryState && stored && stored === queryState);
  if (!code || !payload || !stateMatches) {
    redirect(response, "/chat?github=error", "kazer_github_oauth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    return;
  }

  const { clientId, clientSecret, redirectUri } = getGitHubConfig(request);
  if (!clientId || !clientSecret) {
    redirect(response, "/chat?github=not-configured", "kazer_github_oauth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    return;
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(8000),
    });
    const tokenData = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokenData?.access_token) throw new Error("github_token_exchange_failed");

    const githubUser = await githubFetch("/user", tokenData.access_token);
    const githubEmails = await githubFetch("/user/emails", tokenData.access_token).catch(() => []);
    const primaryEmail = Array.isArray(githubEmails) ? githubEmails.find((item) => item.primary)?.email || githubEmails[0]?.email || null : null;
    const row = {
      user_id: payload.userId,
      github_user_id: String(githubUser.id),
      login: String(githubUser.login || "").slice(0, 120),
      display_name: String(githubUser.name || githubUser.login || "").slice(0, 160) || null,
      avatar_url: String(githubUser.avatar_url || "").slice(0, 1000) || null,
      access_token_encrypted: encryptSecret(tokenData.access_token),
      scope: String(tokenData.scope || "repo,read:user,user:email").slice(0, 500),
    };

    const updated = await supabaseRequest("kazer_github_connections", {
      method: "PATCH",
      query: { user_id: `eq.${payload.userId}` },
      body: row,
    });
    if (!Array.isArray(updated) || updated.length === 0) {
      await supabaseRequest("kazer_github_connections", { method: "POST", body: row });
    }

    const cookieHeader = `kazer_github_oauth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    redirect(response, "/chat?github=connected", cookieHeader);
  } catch (error) {
    console.error("GitHub callback failed", error?.message || "unknown");
    const cookieHeader = `kazer_github_oauth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    redirect(response, "/chat?github=error", cookieHeader);
  }
};
