const { exchangeCode, saveConnection, verifyState } = require("./_google-drive");
module.exports = async (request, response) => {
  const query = request.query || {};
  const redirect = (status, message) => { response.status(status); response.setHeader("Content-Type", "text/html; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.end(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><script>window.opener?.postMessage(${JSON.stringify({ type: "kazer-google-drive", status, message })}, window.location.origin);window.close();</script><p>${message}</p>`); };
  try {
    if (query.error) return redirect(400, "A autorização do Google Drive foi cancelada.");
    const state = verifyState(query.state); if (!query.code) return redirect(400, "Código de autorização ausente.");
    const token = await exchangeCode(query.code); await saveConnection(state.userId, token);
    return redirect(200, "Google Drive conectado ao KAZER.");
  } catch (error) { console.error("Google Drive callback failed", error); return redirect(500, "Não foi possível concluir a conexão com o Google Drive."); }
};
