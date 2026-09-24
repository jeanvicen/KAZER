import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const chatApi = await readFile(`${root}/api/chat.js`, "utf8");
const chatUi = await readFile(`${root}/interface/chat.html`, "utf8");
const webApi = await readFile(`${root}/api/web-search.js`, "utf8");
const apk = await readFile(`${root}/download/android/kazer.apk`);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

execFileSync(process.execPath, ["--check", `${root}/api/chat.js`]);
const inlineScripts = [...chatUi.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim())
  .join("\n");
const inlineCheckPath = "/tmp/kazer-chat-inline-regression.js";
writeFileSync(inlineCheckPath, inlineScripts);
try {
  execFileSync(process.execPath, ["--check", inlineCheckPath]);
} finally {
  unlinkSync(inlineCheckPath);
}
assert(chatApi.includes("hasExpectedFileSignature"), "A API não valida assinatura dos anexos");
assert(webApi.includes("callKazerBrain") && webApi.includes("KAZER_SEARCH_MODEL"), "A pesquisa não usa o cérebro Qwen configurado");
assert(chatUi.includes("web-source-details") && chatUi.includes("Fontes encontradas"), "A pesquisa não mostra fontes em painel recolhível");
assert(chatApi.includes("attachment_signature_invalid"), "A API não rejeita assinatura de anexo inválida");
assert(chatApi.includes("MAX_TOTAL_ATTACHMENT_BYTES"), "A API não limita o tamanho total dos anexos");
assert(chatApi.includes("MAX_IMAGES"), "A API não limita a quantidade de imagens");
assert(chatApi.includes("_kazer-brain") && chatApi.includes("KAZER_BRAIN_VERSION"), "O chat não está conectado ao cérebro KAZER");
assert(chatApi.includes('brain: KAZER_BRAIN_VERSION'), "A resposta não identifica a versão pública kazer.v1");
assert(chatUi.includes("selectedFiles = files;"), "O frontend não preserva anexos depois de uma falha");
assert(chatUi.includes("A mensagem que falhou continua sendo contexto válido"), "O frontend ainda remove o contexto quando a resposta falha");
assert(!chatUi.includes("conversationMessages.pop();"), "O frontend ainda descarta a mensagem que falhou");
assert(!/voice|microphone|getUserMedia|SpeechRecognition|voiceButton/i.test(chatUi), "A interface ainda contém referências ao microfone");
assert(!chatUi.includes("getUserMedia") && !chatUi.includes("SpeechRecognition"), "O JavaScript ainda tenta acessar o microfone");
assert(!/nexoSkills|NEXO|MENTE|SKILLS|memory|memories|Memória|memórias/.test(chatUi), "A interface ainda contém memória ou NEXO // MENTE & SKILLS");
assert(!chatUi.includes("nexoSkillsButton.addEventListener"), "A opção NEXO // MENTE & SKILLS já possui uma ação antes da hora");
assert(chatUi.includes("installProgress") && chatUi.includes("installCompletionTimer"), "A instalação não possui progresso nem timeout");
assert(chatUi.includes('fetch("/download/android/kazer.apk"') && chatUi.includes('link.download = "kazer.apk"'), "O botão não baixa o APK real");
assert(chatUi.includes("appinstalled") && chatUi.includes("setInstallProgress(100"), "A instalação não confirma conclusão real");
assert(apk.length > 500000 && apk.subarray(0, 2).toString() === "PK", "O APK release publicado não é um pacote Android válido");
console.log("chat-regression: OK — contexto, anexos, assinatura, instalação, memória e NEXO removidos, e microfone verificados.");
