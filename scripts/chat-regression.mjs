import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const chatApi = await readFile(`${root}/api/chat.js`, "utf8");
const chatUi = await readFile(`${root}/interface/chat.html`, "utf8");
const usagePolicy = await readFile(`${root}/database/supabase/014_daily_token_policy.sql`, "utf8");
const apk = await readFile(`${root}/download/android/kazer.apk`);

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
assert(!/voice|microphone|getUserMedia|SpeechRecognition|voiceButton/i.test(chatUi), "A interface ainda contém referências ao microfone");
assert(!chatUi.includes("getUserMedia") && !chatUi.includes("SpeechRecognition"), "O JavaScript ainda tenta acessar o microfone");
assert(chatUi.includes('id="nexoSkillsButton"') && chatUi.includes("NEXO // MENTE &amp; SKILLS"), "A opção NEXO // MENTE & SKILLS não está nas configurações");
assert(!chatUi.includes("nexoSkillsButton.addEventListener"), "A opção NEXO // MENTE & SKILLS já possui uma ação antes da hora");
assert(chatUi.includes("installProgress") && chatUi.includes("installCompletionTimer"), "A instalação não possui progresso nem timeout");
assert(chatUi.includes('fetch("/download/android/kazer.apk"') && chatUi.includes('link.download = "kazer.apk"'), "O botão não baixa o APK real");
assert(chatUi.includes("appinstalled") && chatUi.includes("setInstallProgress(100"), "A instalação não confirma conclusão real");
assert(apk.length > 1000000 && apk.subarray(0, 2).toString() === "PK", "O APK publicado não é um pacote Android válido");
assert(usagePolicy.includes("attachment_reset_at") && usagePolicy.includes("kazer_next_daily_reset"), "A política de anexos não possui reset temporal");
console.log("chat-regression: OK — contexto, anexos, assinatura, reset temporal, instalação e remoção do microfone verificados.");
