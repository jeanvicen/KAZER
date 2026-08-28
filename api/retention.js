const INACTIVITY_YEARS = 3;
const MAX_DELETIONS_PER_RUN = 100;

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function subtractYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result;
}

function authorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const authorization = request.headers.authorization || '';
  return authorization === `Bearer ${expected}`;
}

async function supabaseRequest(url, options, serviceKey) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${body.slice(0, 240)}`);
  }
  return body ? JSON.parse(body) : null;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Método não permitido.' });
  }
  if (!authorized(request)) {
    return sendJson(response, 401, { error: 'Não autorizado.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return sendJson(response, 503, { error: 'A retenção ainda não foi configurada.' });
  }

  const cutoff = subtractYears(new Date(), INACTIVITY_YEARS).toISOString();
  const query = new URL('/rest/v1/user_settings', `${supabaseUrl}/`).toString()
    + `?select=user_id,last_activity_at&last_activity_at=lt.${encodeURIComponent(cutoff)}&order=last_activity_at.asc&limit=${MAX_DELETIONS_PER_RUN}`;

  try {
    const inactiveUsers = await supabaseRequest(query, { method: 'GET' }, serviceKey);
    const deleted = [];
    for (const user of inactiveUsers || []) {
      if (!user?.user_id) continue;
      const deleteUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(user.user_id)}`;
      await supabaseRequest(deleteUrl, { method: 'DELETE' }, serviceKey);
      deleted.push(user.user_id);
    }
    return sendJson(response, 200, {
      ok: true,
      cutoff,
      candidates: (inactiveUsers || []).length,
      deleted: deleted.length,
    });
  } catch (error) {
    console.error('Retention job failed', error?.message || 'unknown');
    return sendJson(response, 502, { error: 'A rotina de retenção não pôde ser concluída.' });
  }
};
