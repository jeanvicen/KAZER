/*
 * KAZER — Copyright © 2026 Jean V. / @jeanvicen · 0neajx · KLYPZA.
 * Código proprietário. Consulte /LICENSE.md antes de reutilizar este arquivo.
 */
const {
  authenticateUser,
  getBearerToken,
  hasSafeFetchMetadata,
  isSameOrigin,
  sendJson,
  supabaseBaseUrl,
} = require("./_security");

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_1z--HkCLItfs9qqHdf8WHA_WwhPVfnS";

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) {
    return sendJson(response, 403, { error: "Origem não autorizada." });
  }
  const user = await authenticateUser(request);
  const token = getBearerToken(request);
  const baseUrl = supabaseBaseUrl();
  if (!user || !token || !baseUrl) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });

  try {
    const result = await fetch(`${baseUrl}/rest/v1/rpc/get_my_usage`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    const data = await result.json().catch(() => null);
    if (!result.ok) return sendJson(response, 502, { error: "Não foi possível consultar o uso da conta." });
    return sendJson(response, 200, Array.isArray(data) ? data[0] || {} : data || {});
  } catch {
    return sendJson(response, 502, { error: "Não foi possível consultar o uso da conta." });
  }
};
