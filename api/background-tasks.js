const { getUserBearer, requireUser, supabaseRequest, unauthorized } = require("./_kazer-data");
const { applyRateLimit, publicSupabaseAnonKey, rateLimit, requestExceedsLimit, sendJson, supabaseBaseUrl } = require("./_security");

const MAX_TASK_BYTES = 7 * 1024 * 1024;
const TASK_TYPES = new Set(["chat_response", "web_search", "document_analysis", "file_processing", "image_generation", "report_generation", "computer_agent", "upload_processing", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

function taskPromptPreview(row) {
  return String(row?.input_preview || "").slice(0, 400);
}

function clientTask(row) {
  if (!row) return null;
  return {
    taskId: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id || null,
    messageId: row.message_id || null,
    type: row.task_type,
    inputPreview: taskPromptPreview(row),
    status: row.status,
    stage: row.stage || null,
    progress: Number.isInteger(row.progress) ? row.progress : null,
    partialResult: row.partial_result || null,
    result: row.result || null,
    error: row.error || null,
    metadata: row.metadata || {},
    usage: row.usage_snapshot || null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    notificationSentAt: row.notification_sent_at || null,
    resultViewedAt: row.result_viewed_at || null,
    retryCount: Number(row.retry_count || 0),
  };
}

async function enqueueTask(request, user, body) {
  const type = String(body.type || "");
  if (!TASK_TYPES.has(type)) return { status: 400, data: { error: "Tipo de tarefa inválido." } };
  const input = body.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, data: { error: "Conteúdo da tarefa inválido." } };
  const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  const bodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (inputBytes > MAX_TASK_BYTES || bodyBytes > MAX_TASK_BYTES) return { status: 413, data: { error: "O conteúdo da tarefa excede o limite permitido." } };
  const key = String(body.idempotencyKey || "");
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) return { status: 400, data: { error: "Chave de idempotência inválida." } };
  const conversationId = body.conversationId == null ? null : String(body.conversationId).slice(0, 128);
  const messageId = body.messageId == null ? null : String(body.messageId).slice(0, 128);
  const attachmentCount = Array.isArray(input.attachments) ? input.attachments.length : 0;
  if (attachmentCount > 10) return { status: 400, data: { error: "Quantidade de anexos inválida." } };
  const url = supabaseBaseUrl();
  const token = getUserBearer(request);
  const anonKey = publicSupabaseAnonKey();
  if (!url || !token || !anonKey) return { status: 503, data: { error: "O processamento de tarefas não está configurado." } };

  let response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/kazer_enqueue_background_task`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        p_task_type: type,
        p_input_payload: input,
        p_idempotency_key: key,
        p_conversation_id: conversationId,
        p_message_id: messageId,
        p_attachment_count: attachmentCount,
        p_metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: 503, data: { error: "Não foi possível registrar a tarefa agora." } };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = String(data?.message || data?.code || "");
    if (reason === "usage_limit_reached" || reason === "credits_limit_reached") return { status: 402, data: { error: "Seu uso mensal chegou a 100%.", usage: { usage_limit_reached: true, credits_limit_reached: true } } };
    if (reason === "task_payload_too_large") return { status: 413, data: { error: "O conteúdo da tarefa excede o limite permitido." } };
    console.error("Background task enqueue failed", reason || response.status);
    return { status: response.status === 401 ? 401 : 503, data: { error: "Não foi possível registrar a tarefa agora." } };
  }
  const task = data?.task;
  if (!task?.id) return { status: 503, data: { error: "O servidor não confirmou a tarefa." } };
  return { status: data.created ? 202 : 200, data: { task: clientTask(task), created: Boolean(data.created) } };
}

async function updateTask(userId, id, operation) {
  if (!UUID.test(id)) return { status: 400, data: { error: "Identificador de tarefa inválido." } };
  const rows = await supabaseRequest("kazer_background_tasks", {
    query: { select: "id,user_id,status,retry_count", id: `eq.${id}`, user_id: `eq.${userId}`, limit: 1 },
  });
  const current = Array.isArray(rows) ? rows[0] : null;
  if (!current) return { status: 404, data: { error: "Tarefa não encontrada." } };
  let status;
  if (operation === "viewed") {
    const now = new Date().toISOString();
    const updated = await supabaseRequest("kazer_background_tasks", {
      method: "PATCH", query: { id: `eq.${id}`, user_id: `eq.${userId}` },
      body: { last_client_seen_at: now, result_viewed_at: now },
    });
    const row = Array.isArray(updated) ? updated[0] : null;
    await supabaseRequest("kazer_background_task_events", { method: "POST", body: { task_id: id, user_id: userId, event_type: "viewed" } });
    return { status: 200, data: { task: clientTask(row) } };
  }
  if (operation === "cancel" && ["queued", "paused"].includes(current.status)) status = "cancelled";
  else if (operation === "cancel" && current.status === "running") return { status: 409, data: { error: "A tarefa já está em execução e não pode ser interrompida com segurança. O resultado continuará sincronizando." } };
  else if (operation === "pause" && current.status === "queued") status = "paused";
  else if (operation === "resume" && current.status === "paused") status = "queued";
  else if (operation === "retry" && current.status === "failed" && Number(current.retry_count || 0) < 10) status = "queued";
  else return { status: 409, data: { error: "Esta ação não está disponível para o estado atual da tarefa." } };
  const update = await supabaseRequest("kazer_background_tasks", {
    method: "PATCH", query: { id: `eq.${id}`, user_id: `eq.${userId}`, status: `eq.${current.status}` },
    body: { status, stage: status === "queued" ? "queued" : status, error: status === "queued" ? null : undefined, locked_by: null, lease_until: null, updated_at: new Date().toISOString() },
  });
  const row = Array.isArray(update) ? update[0] : null;
  if (!row) return { status: 409, data: { error: "A tarefa mudou enquanto você atualizava. Sincronize e tente novamente." } };
  const eventType = operation === "retry" ? "retried" : operation === "resume" ? "resumed" : operation === "pause" ? "paused" : "cancelled";
  await supabaseRequest("kazer_background_task_events", { method: "POST", body: { task_id: id, user_id: userId, event_type: eventType } });
  return { status: 200, data: { task: clientTask(row) } };
}

module.exports = async function handler(request, response) {
  if (!["GET", "POST", "PATCH"].includes(request.method)) { response.setHeader("Allow", "GET, POST, PATCH"); return sendJson(response, 405, { error: "Método não permitido." }); }
  if (request.method === "POST" && requestExceedsLimit(request, MAX_TASK_BYTES)) return sendJson(response, 413, { error: "O conteúdo da tarefa excede o limite permitido." });
  const user = await requireUser(request);
  if (!user) return unauthorized(response);
  const limit = rateLimit(request, "background-task-user", { limit: 20, windowMs: 60_000, identity: user.id }); applyRateLimit(response, limit);
  if (!limit.allowed) return sendJson(response, 429, { error: "Muitas solicitações. Aguarde um momento." });

  try {
    if (request.method === "POST") {
      const body = parseBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "JSON inválido." });
      const result = await enqueueTask(request, user, body);
      return sendJson(response, result.status, result.data);
    }
    if (request.method === "PATCH") {
      const body = parseBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "JSON inválido." });
      const result = await updateTask(user.id, String(body.taskId || ""), String(body.action || ""));
      return sendJson(response, result.status, result.data);
    }
    const url = new URL(request.url || "/api/background-tasks", `https://${request.headers.host || "localhost"}`);
    const id = url.searchParams.get("id");
    const conversationId = url.searchParams.get("conversationId");
    const query = {
      select: "id,user_id,conversation_id,message_id,task_type,input_preview,status,stage,progress,partial_result,result,error,metadata,retry_count,created_at,started_at,updated_at,completed_at,notification_sent_at,result_viewed_at",
      user_id: `eq.${user.id}`,
      order: "created_at.desc",
      limit: id ? 1 : 50,
    };
    if (id) { if (!UUID.test(id)) return sendJson(response, 400, { error: "Identificador de tarefa inválido." }); query.id = `eq.${id}`; }
    if (conversationId) query.conversation_id = `eq.${conversationId.slice(0,128)}`;
    const rows = await supabaseRequest("kazer_background_tasks", { query });
    if (id && !rows?.length) return sendJson(response, 404, { error: "Tarefa não encontrada." });
    if (id) await supabaseRequest("kazer_background_tasks", { method: "PATCH", query: { id: `eq.${id}`, user_id: `eq.${user.id}` }, body: { last_client_seen_at: new Date().toISOString() } });
    return sendJson(response, 200, { tasks: (Array.isArray(rows) ? rows : []).map(clientTask) });
  } catch (error) {
    console.error("Background tasks endpoint failed", error?.message || "unknown");
    return sendJson(response, error?.status === 503 ? 503 : 500, { error: "Não foi possível sincronizar as tarefas agora." });
  }
};

module.exports.clientTask = clientTask;
module.exports.UUID = UUID;
