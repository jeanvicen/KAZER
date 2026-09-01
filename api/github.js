/**
 * KAZER — GitHub route dispatcher.
 * Public paths are kept stable through vercel.json rewrites while the Hobby
 * deployment counts this file as a single serverless function.
 */
const handlers = {
  connect: require("./_github-connect-handler"),
  callback: require("./_github-callback-handler"),
  status: require("./_github-status-handler"),
  repos: require("./_github-repos-handler"),
  disconnect: require("./_github-disconnect-handler"),
};

module.exports = async function handler(request, response) {
  const route = String(request?.query?.route || "status").toLowerCase();
  const selected = handlers[route];
  if (!selected) {
    response.setHeader("Allow", "connect, callback, status, repos, disconnect");
    response.status(404).json({ error: "Rota GitHub não encontrada." });
    return;
  }
  return selected(request, response);
};
