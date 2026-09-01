/**
 * KAZER — workspace route dispatcher.
 * MCP and task APIs share one Vercel Function to remain within the Hobby limit.
 */
const handlers = {
  mcp: require("./_mcp-handler"),
  tasks: require("./_tasks-handler"),
};

module.exports = async function handler(request, response) {
  const route = String(request?.query?.route || "tasks").toLowerCase();
  const selected = handlers[route];
  if (!selected) {
    response.setHeader("Allow", "mcp, tasks");
    response.status(404).json({ error: "Rota de workspace não encontrada." });
    return;
  }
  return selected(request, response);
};
