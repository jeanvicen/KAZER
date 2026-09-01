const {
  getBearerToken,
  publicSupabaseAnonKey,
  supabaseBaseUrl,
} = require("./_security");

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || publicSupabaseAnonKey();

async function callUsageRpc(request, name, args = {}) {
  const token = getBearerToken(request);
  const baseUrl = supabaseBaseUrl();
  if (!token || !baseUrl) throw Object.assign(new Error("usage_auth_missing"), { code: "not_authenticated" });

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || data?.error || "usage_rpc_failed");
    error.status = response.status;
    error.code = [
      "credits_limit_reached",
      "attachment_limit_reached",
      "not_authenticated",
      "invalid_credit_amount",
      "invalid_attachment_count",
    ].includes(data?.message) ? data.message : data?.code || "usage_rpc_failed";
    throw error;
  }
  return Array.isArray(data) ? data[0] || {} : data || {};
}

module.exports = { callUsageRpc };
