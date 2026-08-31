const { authenticateUser, applyRateLimit, isSameOrigin, hasSafeFetchMetadata, rateLimit, sendJson, requestExceedsLimit } = require("./_security");
const { callUsageRpc } = require("./_usage");
const { accessTokenForRequest, deleteConnection, driveFetch, getConnection } = require("./_google-drive");
const { emit, narrate, startEventStream } = require("./_plugin-runtime");

const MAX_BODY = 8 * 1024 * 1024;
function bodyOf(request) { if (typeof request.body === "object" && request.body) return request.body; try { return JSON.parse(request.body || "{}"); } catch { return null; } }
const dynamicNarration = narrate;
const startStream = startEventStream;
module.exports = async (request, response) => {
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return sendJson(response, 403, { error: "Origem não permitida." });
  const user = await authenticateUser(request); if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
  const limit = rateLimit(request, "google-drive-action", { limit: 12, windowMs: 60000, identity: user.id }); limit.limit = 12; applyRateLimit(response, limit); if (!limit.allowed) return sendJson(response, 429, { error: "Limite de ações atingido. Aguarde um minuto." });
  if (request.method === "GET") {
    try { const connection = await getConnection(user.id); return sendJson(response, 200, { connected: Boolean(connection), updated_at: connection?.updated_at || null }); } catch { return sendJson(response, 503, { error: "Não foi possível consultar a conexão." }); }
  }
  if (request.method === "DELETE") { try { await deleteConnection(user.id); return sendJson(response, 200, { connected: false }); } catch { return sendJson(response, 503, { error: "Não foi possível desconectar o Google Drive." }); } }
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método não permitido." }, { Allow: "GET, POST, DELETE" });
  if (requestExceedsLimit(request, MAX_BODY)) return sendJson(response, 413, { error: "Arquivo grande demais." });
  const body = bodyOf(request); if (!body || !["search", "read", "upload"].includes(body.action)) return sendJson(response, 400, { error: "Ação do Google Drive inválida." });
  let accessToken; try { accessToken = await accessTokenForRequest(request, user.id); } catch (error) { const status = error.message.includes("not_connected") || error.message.includes("reconnect") ? 409 : 503; return sendJson(response, status, { error: status === 409 ? "Conecte o Google Drive antes de usar esta ação." : "Não foi possível acessar o Google Drive." }); }
  let usage; try { usage = await callUsageRpc(request, "consume_chat_usage", { p_credit_amount: 10, p_attachment_count: 0 }); } catch (error) { if (error.code === "credits_limit_reached") return sendJson(response, 402, { error: "Você atingiu seu limite de créditos.", usage: { credits_limit_reached: true } }); return sendJson(response, 503, { error: "Não foi possível validar os limites da conta agora." }); }
  startStream(response); const apiKey = process.env.GROQ_API_KEY;
  try {
    await dynamicNarration(response, apiKey, `Ação real iniciada no Google Drive: ${body.action}. Pedido específico: ${String(body.query || body.name || "operação de arquivo").slice(0, 300)}.`);
    if (body.action === "search") {
      const query = String(body.query || "").trim().slice(0, 200); if (!query) throw new Error("search_query_required");
      const q = `trashed = false and name contains '${query.replace(/'/g, "\\'")}'`; const data = await driveFetch(accessToken, `files?q=${encodeURIComponent(q)}&pageSize=20&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`);
      await dynamicNarration(response, apiKey, `A busca terminou no Google Drive. Foram encontrados ${data.files?.length || 0} arquivos para o termo “${query}”.`); emit(response, "result", { action: body.action, files: data.files || [] });
    } else if (body.action === "read") {
      const file = await driveFetch(accessToken, `files/${encodeURIComponent(String(body.fileId || ""))}?alt=media`); await dynamicNarration(response, apiKey, `O arquivo solicitado foi localizado e seu conteúdo foi recuperado do Google Drive.`); emit(response, "result", { action: body.action, content: file });
    } else {
      const name = String(body.name || "arquivo-kazer.txt").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120); let content; const dataUrlMatch = String(body.dataUrl || "").match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/); if (dataUrlMatch) content = Buffer.from(dataUrlMatch[1].replace(/\s/g, ""), "base64"); else content = Buffer.from(String(body.content || ""), "utf8"); if (!content.length || content.length > 5 * 1024 * 1024) throw new Error("upload_invalid");
      const boundary = `kazer_${Date.now()}`; const metadata = JSON.stringify({ name, mimeType: body.mimeType || "text/plain" }); const multipart = Buffer.concat([Buffer.from(`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${metadata}\r
--${boundary}\r
Content-Type: ${body.mimeType || "text/plain"}\r
\r
`), content, Buffer.from(`\r
--${boundary}--`)]);
      const responseUpload = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart, signal: AbortSignal.timeout(30000) }); const uploaded = await responseUpload.json().catch(() => ({})); if (!responseUpload.ok) throw new Error(uploaded?.error?.message || "upload_failed");
      await dynamicNarration(response, apiKey, `O upload terminou com sucesso. O arquivo criado se chama “${name}”.`); emit(response, "result", { action: body.action, file: uploaded });
    }
    emit(response, "done", { usage }); response.end();
  } catch (error) { emit(response, "error", { error: error.message === "search_query_required" ? "Informe o que deseja buscar." : "Não foi possível concluir a ação no Google Drive." }); response.end(); }
};
