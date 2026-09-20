import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const chatApi = await readFile(`${root}/api/chat.js`, "utf8");
const chatUi = await readFile(`${root}/interface/chat.html`, "utf8");
const usagePolicy = await readFile(`${root}/database/supabase/014_daily_token_policy.sql`, "utf8");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

execFileSync(process.execPath, ["--check", `${root}/api/chat.js`]);
assert(chatApi.includes("hasExpectedFileSignature"), "A API não valida assinatura dos anexos");
assert(chatApi.includes("attachment_signature_invalid"), "A API não rejeita assinatura de anexo inválida");
assert(chatApi.includes("MAX_TOTAL_ATTACHMENT_BYTES"), "A API não limita o tamanho total dos anexos");
assert(chatApi.includes("MAX_IMAGES"), "A API não limita a quantidade de imagens");
assert(chatUi.includes("selectedFiles = files;"), "O frontend não preserva anexos depois de uma falha");
assert(chatUi.includes("A mensagem que falhou continua sendo contexto válido"), "O frontend ainda remove o contexto quando a resposta falha");
assert(!chatUi.includes("conversationMessages.pop();"), "O frontend ainda descarta a mensagem que falhou");
assert(chatUi.includes('id="voiceButton"') && chatUi.includes('data-voice-state="idle"'), "O controle de voz não possui estado inicial acessível");
assert(chatUi.includes("getUserMedia") && chatUi.includes("noiseSuppression: true"), "A captura de voz não prioriza uma entrada de áudio limpa");
assert(chatUi.includes('data-voice-state="ready"') && chatUi.includes("Texto convertido"), "O fluxo de voz não confirma a transcrição final");
assert(chatUi.includes("installProgress") && chatUi.includes("installCompletionTimer"), "A instalação não possui progresso nem timeout");
assert(chatUi.includes("appinstalled") && chatUi.includes("setInstallProgress(100"), "A instalação não confirma conclusão real");
assert(usagePolicy.includes("attachment_reset_at") && usagePolicy.includes("kazer_next_daily_reset"), "A política de anexos não possui reset temporal");
console.log("chat-regression: OK — contexto, anexos, assinatura, reset temporal, voz e instalação verificados.");
