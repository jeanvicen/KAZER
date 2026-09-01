const { decodeToken, getConnection, githubFetch, repoForClient } = require("./_github");
const { requireUser, unauthorized } = require("./_kazer-data");
const { sendJson } = require("./_security");

function value(request, name, fallback) {
  const raw = request.query?.[name];
  return Array.isArray(raw) ? raw[0] : raw ?? fallback;
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);

  try {
    const connection = await getConnection(user.id);
    if (!connection) return sendJson(response, 409, { error: "Conecte o GitHub para visualizar seus repositórios." });
    const token = decodeToken(connection);
    if (!token) return sendJson(response, 409, { error: "A conexão GitHub precisa ser refeita." });

    const page = Math.max(1, Math.min(100, Number.parseInt(value(request, "page", "1"), 10) || 1));
    const perPage = Math.max(1, Math.min(50, Number.parseInt(value(request, "per_page", "25"), 10) || 25));
    const search = String(value(request, "search", "")).trim().slice(0, 120);
    const endpoint = search
      ? `/search/repositories?q=${encodeURIComponent(`${search} user:${connection.login}`)}&page=${page}&per_page=${perPage}&sort=updated&order=desc`
      : `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&page=${page}&per_page=${perPage}&sort=updated&direction=desc`;
    const data = await githubFetch(endpoint, token);
    const repos = search ? data?.items || [] : data || [];
    return sendJson(response, 200, {
      username: connection.login,
      repos: repos.map(repoForClient),
      page,
      perPage,
      hasMore: repos.length === perPage,
    });
  } catch (error) {
    console.error("GitHub repos failed", error?.message || "unknown");
    if (error?.status === 401) return sendJson(response, 409, { error: "A conexão GitHub expirou. Conecte novamente." });
    return sendJson(response, 502, { error: "Não foi possível carregar os repositórios do GitHub." });
  }
};
