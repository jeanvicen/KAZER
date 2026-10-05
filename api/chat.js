/* RESTORE FROM 873d3b65 - temporary stub - see next commit */
module.exports = async function handler(request, response) {
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: 'Chat temporarily unavailable during restore. Please redeploy from commit 873d3b65ba9aebc57682805f75dad12e131e40bd for api/chat.js.' }));
};
