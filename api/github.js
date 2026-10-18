/**
 * KAZER — GitHub route dispatcher.
 * Public paths are kept stable through vercel.json rewrites while the Hobby
 * deployment counts this file as a single serverless function.
 */
const handlers = {
  connect: require("../server/integrations/_github-connect-handler"),
  authorize: require("../server/integrations/_github-authorize-handler"),
  callback: require("../server/integrations/_github-callback-handler"),
  status: require("../server/integrations/_github-status-handler"),
  repos: require("../server/integrations/_github-repos-handler"),
  disconnect: require("../server/integrations/_github-disconnect-handler"),
};

module.exports = async function handler(request, response) {
  const route = String(request?.query?.route || "status").toLowerCase();
  const selected = handlers[route];
  if (!selected) {
    response.setHeader("Allow", "connect, authorize, callback, status, repos, disconnect");
    response.status(404).json({ error: "Rota GitHub não encontrada." });
    return;
  }
  return selected(request, response);
};
