const {
  hasSafeFetchMetadata,
  readTextWithLimit,
  redactSensitiveText,
  sendJson,
  supabaseBaseUrl,
  timingSafeEqualText,
} = require("./_security");

const INACTIVITY_YEARS = 3;
const WARNING_DAYS = [50, 30, 5];
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const MAX_USERS_PER_RUN = 500;
const MAX_DELETIONS_PER_RUN = 100;

function subtractYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function daysUntilDeletion(deletionDate, now) {
  return Math.max(0, Math.ceil((deletionDate.getTime() - now.getTime()) / 86400000));
}

function warningForRemainingDays(remainingDays) {
  return WARNING_DAYS.find((days) => remainingDays <= days) || null;
}

function authorized(request) {
  const expected = String(process.env.CRON_SECRET || "");
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return Boolean(expected && match && timingSafeEqualText(match[1], expected));
}

async function supabaseRequest(url, options, serviceKey) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {}),
    },
  });
  const body = await readTextWithLimit(response, MAX_UPSTREAM_BYTES);
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${redactSensitiveText(body).slice(0, 240)}`);
  }
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    throw new Error("Supabase returned invalid JSON");
  }
}

function warningText(days) {
  if (days === 50) {
    return {
      title: 'Sua conta ficará inativa em 50 dias',
      message: 'Para manter sua conta e seus dados, entre no KAZER ou use o aplicativo antes desse prazo. Qualquer atividade registrada reinicia a contagem de inatividade.',
    };
  }
  if (days === 30) {
    return {
      title: 'Faltam 30 dias para a exclusão da conta',
      message: 'Sua conta continua sem atividade. Acesse o KAZER antes do prazo para manter sua conta ativa e interromper a contagem.',
    };
  }
  return {
    title: 'Último aviso: faltam 5 dias',
    message: 'Sua conta poderá ser excluída permanentemente em 5 dias por falta de atividade. Entre no KAZER agora para manter sua conta.',
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Método não permitido.' });
  }
  if (!hasSafeFetchMetadata(request) || !authorized(request)) {
    return sendJson(response, 401, { error: 'Não autorizado.' });
  }

  const supabaseUrl = supabaseBaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return sendJson(response, 503, { error: 'A retenção ainda não foi configurada.' });
  }

  const now = new Date();
  const deletionCutoff = subtractYears(now, INACTIVITY_YEARS);
  const warningWindowStart = addDays(deletionCutoff, -Math.max(...WARNING_DAYS));
  const query = new URL('/rest/v1/user_settings', `${supabaseUrl}/`).toString()
    + `?select=user_id,last_activity_at&last_activity_at=lt.${encodeURIComponent(deletionCutoff.toISOString())}&order=last_activity_at.asc&limit=${MAX_USERS_PER_RUN}`;

  try {
    const inactiveUsers = await supabaseRequest(query, { method: 'GET' }, serviceKey);
    const warningCandidates = [];
    const deletionCandidates = [];

    for (const user of inactiveUsers || []) {
      if (!user?.user_id || !user?.last_activity_at) continue;
      const lastActivity = new Date(user.last_activity_at);
      const deletionDate = addYears(lastActivity, INACTIVITY_YEARS);
      const remainingDays = daysUntilDeletion(deletionDate, now);
      const isWithinWarningWindow = lastActivity >= warningWindowStart && lastActivity < deletionCutoff;
      const warningDays = isWithinWarningWindow ? warningForRemainingDays(remainingDays) : null;
      if (warningDays) warningCandidates.push({ ...user, warningDays });
      if (lastActivity < deletionCutoff && deletionCandidates.length < MAX_DELETIONS_PER_RUN) {
        deletionCandidates.push(user);
      }
    }

    let warningsCreated = 0;
    for (const user of warningCandidates) {
      const copy = warningText(user.warningDays);
      const notificationUrl = new URL('/rest/v1/account_notifications', `${supabaseUrl}/`).toString();
      const createdRows = await supabaseRequest(notificationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify({
          user_id: user.user_id,
          kind: 'inactivity_warning',
          warning_days: user.warningDays,
          title: copy.title,
          message: copy.message,
        }),
      }, serviceKey);
      warningsCreated += Array.isArray(createdRows) ? createdRows.length : 0;
    }

    const deleteEnabled = process.env.RETENTION_DELETE_ENABLED === 'true';
    const deleted = [];
    if (deleteEnabled) {
      for (const user of deletionCandidates) {
        const deleteUrl = `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.user_id)}`;
        await supabaseRequest(deleteUrl, { method: 'DELETE' }, serviceKey);
        deleted.push(user.user_id);
      }
    }

    return sendJson(response, 200, {
      ok: true,
      cutoff: deletionCutoff.toISOString(),
      scanned: (inactiveUsers || []).length,
      warningCandidates: warningCandidates.length,
      warningsCreated,
      deletionCandidates: deletionCandidates.length,
      deleteEnabled,
      deleted: deleted.length,
    });
  } catch (error) {
    console.error('Retention job failed', redactSensitiveText(error?.message || 'unknown'));
    return sendJson(response, 502, { error: 'A rotina de retenção não pôde ser concluída.' });
  }
};
