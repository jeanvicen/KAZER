/**
 * KAZER — workspace route dispatcher.
 * MCP, task, Vercel and model-key APIs share one Vercel Function to remain within the Hobby limit.
 */
const handlers = {
  mcp: require("../server/integrations/_mcp-handler"),
  tasks: require("../server/tasks/_tasks-handler"),
  vercel: require("../server/integrations/_vercel").handler,
  models: require("../server/agent/_flame-api").handler,
};

module.exports = async function handler(request, response) {
  const route = String(request?.query?.route || "tasks").toLowerCase();
  const selected = handlers[route];
  if (!selected) {
    response.setHeader("Allow", "mcp, tasks, vercel, models");
    response.status(404).json({ error: "Rota de workspace não encontrada." });
    return;
  }
  return selected(request, response);
};
