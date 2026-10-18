function emit(response, type, payload) { response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); }
async function narrate(response, apiKey, context) {
  if (!apiKey) return;
  try {
    const result = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", temperature: 0.85, max_tokens: 70, messages: [{ role: "system", content: "Gere uma única fala curta, natural e em português brasileiro, como narração de um assistente trabalhando. Não diga que está pensando, não use frases genéricas de status, não invente fatos e use somente o contexto recebido. Responda apenas a fala, com no máximo 120 caracteres." }, { role: "user", content: context }] }), signal: AbortSignal.timeout(8000) });
    const data = await result.json().catch(() => ({})); const text = data?.choices?.[0]?.message?.content?.trim(); if (text) emit(response, "narration", { text: text.slice(0, 180) });
  } catch (error) { console.warn("Plugin narration failed", error?.message || "unknown"); }
}
function startEventStream(response) { response.status(200); response.setHeader("Content-Type", "text/event-stream; charset=utf-8"); response.setHeader("Cache-Control", "no-cache, no-transform"); response.setHeader("Connection", "keep-alive"); response.flushHeaders?.(); }
module.exports = { emit, narrate, startEventStream };
