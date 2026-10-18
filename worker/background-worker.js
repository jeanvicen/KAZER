const crypto = require("node:crypto");
const { supabaseRequest } = require("../server/storage/_kazer-data");
const { attachBackgroundTaskContext } = require("../server/tasks/_background-context");
const chatHandler = require("../api/chat");
const researchHandler = require("../api/research");

const MAX_ERROR_CHARS = 1800;
const HANDLERS = {
  chat_response: chatHandler,
  document_analysis: chatHandler,
  file_processing: chatHandler,
  web_search: researchHandler,
};

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    end(body = "") { this.body = String(body); this.finished = true; },
    json(value) { this.body = JSON.stringify(value); this.finished = true; },
  };
}

async function invokeTask(task) {
  const handler = HANDLERS[task.task_type];
  if (!handler) {
    const error = new Error(task.task_type === "computer_agent"
      ? "O executor do modo Computer ainda não está disponível."
      : task.task_type === "image_generation"
        ? "A geração de imagens ainda não está disponível neste aplicativo."
        : `Ainda não há um processador configurado para ${task.task_type}.`);
    error.permanent = true;
    throw error;
  }
  const body = task.input_payload;
  if (task.task_type !== "web_search" && Array.isArray(body?.mcpConnectorIds) && body.mcpConnectorIds.length) {
    const error = new Error("Tarefas com conectores externos não serão executadas em segundo plano até haver confirmação individual da ação.");
    error.permanent = true;
    throw error;
  }
  const request = {
    method: "POST",
    url: task.task_type === "web_search" ? "/api/research" : "/api/chat",
    headers: {
      host: process.env.KAZER_APP_HOST || "kazer.vercel.app",
      "content-length": String(Buffer.byteLength(JSON.stringify(body || {}), "utf8")),
    },
    body,
  };
  attachBackgroundTaskContext(request, { userId: task.user_id, taskId: task.id, usage: task.usage_snapshot });
  const response = createResponse();
  await handler(request, response);
  let data;
  try { data = response.body ? JSON.parse(response.body) : {}; }
  catch { throw new Error("O processador retornou uma resposta inválida."); }
  if (!response.finished || response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(String(data?.error || "O KAZER não conseguiu concluir essa tarefa.").slice(0, MAX_ERROR_CHARS));
    error.status = response.statusCode;
    error.permanent = response.statusCode < 500 && response.statusCode !== 429;
    throw error;
  }
  return data;
}

async function appendEvent(task, eventType, detail = {}) {
  await supabaseRequest("kazer_background_task_events", {
    method: "POST",
    body: { task_id: task.id, user_id: task.user_id, event_type: eventType, detail },
  });
}

function notificationCopy(task) {
  if (task.status === "waiting_confirmation") return { title: "Kazer precisa da sua confirmação", body: "Uma ação está pronta e precisa da sua autorização.", action: "Revisar" };
  if (task.status === "failed") return { title: "O Kazer não conseguiu concluir uma tarefa", body: "Nenhuma ação sensível foi realizada. Toque para revisar ou tentar novamente.", action: "Ver detalhes" };
  if (task.task_type === "chat_response") return { title: "Kazer respondeu sua mensagem", body: "Sua resposta está pronta para visualizar.", action: "Ver resposta" };
  if (task.task_type === "image_generation") return { title: "Sua imagem está pronta", body: "O Kazer concluiu a geração da sua imagem.", action: "Ver imagem" };
  if (["document_analysis", "file_processing", "upload_processing", "report_generation"].includes(task.task_type)) return { title: "Seu arquivo está pronto", body: "O Kazer finalizou o processamento solicitado.", action: "Abrir arquivo" };
  return { title: "Kazer concluiu sua tarefa", body: task.task_type === "web_search" ? "A pesquisa está pronta para você conferir." : "O resultado está pronto para visualizar.", action: "Ver resultado" };
}

async function processOneNotification(workerId = `worker-${process.pid}`) {
  const claimed = await supabaseRequest("rpc/kazer_claim_background_notification", {
    method: "POST", body: { p_worker_id: workerId, p_lease_seconds: 120 }, timeoutMs: 10_000,
  });
  const task = Array.isArray(claimed) ? claimed[0] : null;
  if (!task?.id) return false;
  try {
    const subscriptions = await supabaseRequest("kazer_push_subscriptions", {
      query: { select: "id,endpoint,platform", user_id: `eq.${task.user_id}`, limit: 50 },
    });
    const devices = Array.isArray(subscriptions) ? subscriptions.filter((item) => /^(?:ExponentPushToken|ExpoPushToken)\[/.test(String(item.endpoint || ""))) : [];
    if (!devices.length) return false;
    const copy = notificationCopy(task);
    const messages = devices.map((item) => ({
      to: item.endpoint,
      title: copy.title,
      body: copy.body,
      sound: "default",
      channelId: "kazer-background-tasks",
      priority: task.status === "failed" || task.status === "waiting_confirmation" ? "high" : "default",
      data: {
        type: "kazer_background_task",
        taskId: task.id,
        conversationId: task.conversation_id || null,
        messageId: task.message_id || null,
        taskType: task.task_type,
        action: copy.action,
      },
    }));
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.data)) throw Object.assign(new Error("push_provider_unavailable"), { retryAfterMs: 60_000 });
    const acceptedIds = [];
    const invalidIds = [];
    payload.data.forEach((ticket, index) => {
      if (ticket?.status === "ok") acceptedIds.push(devices[index]?.id);
      if (ticket?.details?.error === "DeviceNotRegistered") invalidIds.push(devices[index]?.id);
    });
    if (invalidIds.length) await supabaseRequest("kazer_push_subscriptions", { method: "DELETE", query: { id: `in.(${invalidIds.join(",")})`, user_id: `eq.${task.user_id}` } });
    if (!acceptedIds.length) throw Object.assign(new Error("push_not_accepted"), { retryAfterMs: 60_000 });
    const now = new Date().toISOString();
    await supabaseRequest("kazer_background_tasks", {
      method: "PATCH",
      query: { id: `eq.${task.id}`, notification_sent_at: "is.null", notification_claimed_by: `eq.${workerId}` },
      body: { notification_sent_at: now, notification_claimed_by: null, notification_lease_until: null },
    });
    return true;
  } catch (error) {
    const retryAt = new Date(Date.now() + Number(error?.retryAfterMs || 60_000)).toISOString();
    await supabaseRequest("kazer_background_tasks", {
      method: "PATCH",
      query: { id: `eq.${task.id}`, notification_claimed_by: `eq.${workerId}` },
      body: { notification_claimed_by: null, notification_lease_until: retryAt },
    }).catch(() => null);
    console.warn("Push notification delivery deferred", String(error?.message || "unknown").slice(0, MAX_ERROR_CHARS));
    return false;
  }
}

function startTaskHeartbeat(task, workerId) {
  const timer = setInterval(() => {
    const leaseUntil = new Date(Date.now() + 600_000).toISOString();
    supabaseRequest("kazer_background_tasks", {
      method: "PATCH",
      query: { id: `eq.${task.id}`, status: "eq.running", locked_by: `eq.${workerId}`, lease_until: `gt.${new Date().toISOString()}` },
      body: { lease_until: leaseUntil, updated_at: new Date().toISOString() },
    }).catch((error) => console.warn("Background task lease renewal failed", String(error?.message || "unknown").slice(0, MAX_ERROR_CHARS)));
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function processOneTask(workerId = `worker-${process.pid}`) {
  const claimed = await supabaseRequest("rpc/kazer_claim_background_task", {
    method: "POST",
    body: { p_worker_id: workerId, p_lease_seconds: 600 },
    timeoutMs: 10_000,
  });
  const task = Array.isArray(claimed) ? claimed[0] : null;
  if (!task?.id) return false;
  const stopHeartbeat = startTaskHeartbeat(task, workerId);

  try {
    await appendEvent(task, "started", { workerId });
    const currentRows = await supabaseRequest("kazer_background_tasks", {
      query: { select: "id,status", id: `eq.${task.id}`, user_id: `eq.${task.user_id}`, limit: 1 },
    });
    if (!currentRows?.[0] || currentRows[0].status !== "running") return true;
    const result = await invokeTask(task);
    const now = new Date().toISOString();
    const updated = await supabaseRequest("kazer_background_tasks", {
      method: "PATCH",
      query: { id: `eq.${task.id}`, user_id: `eq.${task.user_id}`, status: "eq.running", locked_by: `eq.${workerId}` },
      body: { status: "completed", stage: "completed", progress: 100, result, input_payload: {}, error: null, completed_at: now, updated_at: now, lease_until: null, locked_by: null },
    });
    if (Array.isArray(updated) && updated.length) await appendEvent(task, "completed");
  } catch (error) {
    const retryable = !error?.permanent && (error?.status === 429 || error?.status >= 500 || !error?.status);
    const retry = retryable && Number(task.retry_count || 0) < 3;
    const now = new Date().toISOString();
    const payload = retry
      ? { status: "queued", stage: "retry_pending", error: String(error?.message || "Falha temporária.").slice(0, MAX_ERROR_CHARS), updated_at: now, locked_by: null, lease_until: null }
      : { status: "failed", stage: "failed", error: String(error?.message || "A tarefa falhou.").slice(0, MAX_ERROR_CHARS), completed_at: now, updated_at: now, locked_by: null, lease_until: null };
    const updated = await supabaseRequest("kazer_background_tasks", {
      method: "PATCH", query: { id: `eq.${task.id}`, user_id: `eq.${task.user_id}`, status: "eq.running", locked_by: `eq.${workerId}` }, body: payload,
    });
    if (Array.isArray(updated) && updated.length) await appendEvent(task, retry ? "progress" : "failed", { error: payload.error, retry });
  } finally {
    stopHeartbeat();
  }
  return true;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function purgeExpiredTasks() {
  return supabaseRequest("rpc/kazer_purge_background_tasks", { method: "POST", body: { p_retention_days: 7 }, timeoutMs: 10_000 });
}

async function runWorker({ pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 1500), signal = null } = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const workerId = `kazer-${process.env.WORKER_ID || crypto.randomUUID()}`;
  console.info("KAZER background worker started", { workerId });
  let nextPurgeAt = 0;
  while (!signal?.aborted) {
    try {
      const worked = await processOneTask(workerId);
      await processOneNotification(workerId);
      if (Date.now() >= nextPurgeAt) {
        nextPurgeAt = Date.now() + 60 * 60 * 1000;
        await purgeExpiredTasks().catch((error) => console.warn("Background task retention cleanup deferred", String(error?.message || "unknown").slice(0, MAX_ERROR_CHARS)));
      }
      if (!worked) await sleep(pollIntervalMs);
    } catch (error) {
      console.error("Background worker iteration failed", String(error?.message || "unknown").slice(0, MAX_ERROR_CHARS));
      await sleep(Math.min(30_000, Math.max(3000, pollIntervalMs * 4)));
    }
  }
  console.info("KAZER background worker stopped", { workerId });
}

module.exports = { createResponse, invokeTask, processOneNotification, processOneTask, purgeExpiredTasks, runWorker };
