const { getBearerToken, supabaseBaseUrl } = require("./_security");

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xanVub3B6eWNkZXp6am1saGlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mzg3NDksImV4cCI6MjEwMzQxNDc0OX0.Y_o2_QQhZzuCjvHdEfxaR5VrAxo7NFenPaDmdHN3bwM";

async function callUsageRpc(request, name, args = {}) {
  const token = getBearerToken(request);
  const baseUrl = supabaseBaseUrl();
  if (!token || !baseUrl) throw new Error("usage_auth_missing");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
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
    const businessCode = ["credits_limit_reached", "attachment_limit_reached", "not_authenticated", "invalid_credit_amount"].includes(data?.message) ? data.message : null;
    error.code = businessCode || data?.code || "usage_rpc_failed";
    throw error;
  }
  return Array.isArray(data) ? data[0] || {} : data || {};
}

module.exports = { callUsageRpc };
