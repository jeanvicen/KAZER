const { badRequest, requireUser, supabaseRequest, taskForClient, unauthorized } = require("./_kazer-data");
const { sendJson } = require("./_security");

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return null; }
}

function text(value, max = 8000) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function validRepoUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function validMcpIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 80)).filter(Boolean).slice(0, 30);
}

function safeError(response, error) {
  console.error("Tasks endpoint error", error?.message || "unknown");
  return sendJson(response, error?.status === 503 ? 503 : 500, {
    error: error?.status === 503 ? "A integração com o Supabase não está configurada no servidor." : "Não foi possível acessar as tarefas.",
  });
}

module.exports = async function handler(request, response) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const user = await requireUser(request);
  if (!user) return unauthorized(response);

  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest("kazer_tasks", {
        query: {
          select: "id,title,prompt,task_type,repo_url,selected_agent,selected_model,mcp_connector_ids,status,progress,logs,result,error,credit_cost,created_at,updated_at,completed_at",
          user_id: `eq.${user.id}`,
          order: "created_at.desc",
          limit: 60,
        },
      });
      return sendJson(response, 200, { tasks: (Array.isArray(rows) ? rows : []).map(taskForClient) });
    }

    const body = parseBody(request);
    if (!body || typeof body !== "object") return badRequest(response, "JSON inválido.");
    const id = text(body.id, 80);

    if (request.method === "DELETE") {
      if (!id) return badRequest(response, "Tarefa inválida.");
      await supabaseRequest("kazer_tasks", { method: "DELETE", query: { id: `eq.${id}`, user_id: `eq.${user.id}` } });
      return sendJson(response, 200, { success: true });
    }

    if (request.method === "PATCH") {
      if (!id) return badRequest(response, "Tarefa inválida.");
      const payload = {};
      if (body.title !== undefined) payload.title = text(body.title, 120) || null;
      if (body.status !== undefined && ["pending", "processing", "completed", "error", "stopped"].includes(body.status)) payload.status = body.status;
      if (body.progress !== undefined) payload.progress = Math.max(0, Math.min(100, Number(body.progress) || 0));
      if (body.result !== undefined) payload.result = text(body.result, 16000) || null;
      if (body.error !== undefined) payload.error = text(body.error, 2000) || null;
      if (body.creditCost !== undefined) payload.credit_cost = Math.max(0, Math.min(1000, Number(body.creditCost) || 0));
      if (body.logs !== undefined && Array.isArray(body.logs)) payload.logs = body.logs.slice(-100).map((item) => ({
        type: ["info", "command", "error", "success"].includes(item?.type) ? item.type : "info",
        message: text(item?.message, 1000),
        timestamp: item?.timestamp || new Date().toISOString(),
      }));
      if (payload.status === "completed" || payload.status === "error" || payload.status === "stopped") payload.completed_at = new Date().toISOString();
      if (!Object.keys(payload).length) return badRequest(response, "Nenhuma alteração informada.");
      const rows = await supabaseRequest("kazer_tasks", { method: "PATCH", query: { id: `eq.${id}`, user_id: `eq.${user.id}` }, body: payload });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return sendJson(response, 200, { task: row ? taskForClient(row) : null });
    }

    const prompt = text(body.prompt, 8000);
    if (!prompt) return badRequest(response, "Informe o que a tarefa deve fazer.");
    const taskType = ["chat", "coding", "research", "file"].includes(body.taskType) ? body.taskType : "chat";
    const status = ["pending", "processing"].includes(body.status) ? body.status : "pending";
    const payload = {
      user_id: user.id,
      title: text(body.title, 120) || prompt.slice(0, 72),
      prompt,
      task_type: taskType,
      repo_url: validRepoUrl(body.repoUrl),
      selected_agent: text(body.selectedAgent, 80) || null,
      selected_model: text(body.selectedModel, 120) || null,
      mcp_connector_ids: validMcpIds(body.mcpConnectorIds),
      status,
      progress: Math.max(0, Math.min(100, Number(body.progress) || 0)),
      logs: Array.isArray(body.logs) ? body.logs.slice(-100) : [],
      credit_cost: Math.max(0, Math.min(1000, Number(body.creditCost) || 0)),
    };
    const rows = await supabaseRequest("kazer_tasks", { method: "POST", body: payload });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return sendJson(response, 201, { task: row ? taskForClient(row) : null });
  } catch (error) {
    return safeError(response, error);
  }
};
