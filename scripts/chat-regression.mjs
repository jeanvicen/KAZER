import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { inflateSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const chatApi = await readFile(`${root}/api/chat.js`, "utf8");
const chatUi = await readFile(`${root}/interface/chat.html`, "utf8");
const contextApi = await readFile(`${root}/api/_kazer-context.js`, "utf8");
const instructionsApi = await readFile(`${root}/api/_kazer-instructions.js`, "utf8");
const researchApi = await readFile(`${root}/api/research.js`, "utf8");
const apk = await readFile(`${root}/download/android/kazer.apk`);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const compressedPayload = chatApi.match(/Buffer\.from\("([A-Za-z0-9+/=]+)", "base64"\)/);
const readableChatApi = compressedPayload
  ? inflateSync(Buffer.from(compressedPayload[1], "base64")).toString("utf8")
  : chatApi;
assert(!chatApi.includes("new Function("), "A rota de chat não deve executar um bundle dinâmico opaco");
assert(readableChatApi.includes('require("./_security")') && readableChatApi.includes('require("./_kazer-brain")'), "Os imports centrais do chat devem permanecer estáticos para o bundler da Vercel");
const localModuleRefs = [...readableChatApi.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)].map(([, modulePath]) => modulePath);
assert(localModuleRefs.length >= 8, "Os imports locais do handler não foram detectados");
for (const modulePath of localModuleRefs) {
  await readFile(`${root}/api/${modulePath.slice(2)}.js`, "utf8");
}
const normalizerSource = readableChatApi.match(/function extractModelText[\s\S]*?(?=\nfunction protectKazerIdentity)/);
assert(normalizerSource, "O normalizador de conteúdo do provider não pôde ser localizado");
const cleanModelContent = new Function(
  "redactSensitiveText",
  "MAX_OUTPUT_CHARS",
  "MAX_CODE_OUTPUT_CHARS",
  `${normalizerSource[0]}\nreturn cleanModelContent;`,
)((text) => text, 16000, 64000);
const normalizerCases = [
  cleanModelContent("  plain string\n"),
  cleanModelContent([{ type: "text", text: "array " }, { type: "text", text: "blocks" }]),
  cleanModelContent({ content: { parts: [{ text: "nested object" }] } }),
  cleanModelContent({ role: "assistant", metadata: { id: "not user-facing text" } }),
];
assert(normalizerCases[0] === "plain string", "O normalizador alterou o comportamento de texto simples");
assert(normalizerCases[1] === "array blocks", "O normalizador não extraiu blocos de texto");
assert(normalizerCases[2] === "nested object", "O normalizador não extraiu texto aninhado");
assert(normalizerCases[3] === "", "O normalizador expôs um objeto sem texto reconhecido");
let callableCoercionAttempted = false;
const callableContent = Object.assign(() => {}, { toString() { callableCoercionAttempted = true; return "unsafe"; } });
assert(cleanModelContent(callableContent) === "" && !callableCoercionAttempted, "O normalizador tentou converter um objeto callable em texto");
assert(!normalizerCases.some((value) => value.includes("[object Object]")), "O normalizador produziu [object Object]");
const cyclicContent = {};
cyclicContent.parts = [cyclicContent];
assert(cleanModelContent(cyclicContent) === "", "O normalizador não protegeu a recursão cíclica");

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
assert(researchApi.includes("callKazerBrain") && researchApi.includes("runResearch"), "A pesquisa não está conectada ao Brain/Orchestrator");
assert(researchApi.includes("evidence") && researchApi.includes("visitedUrls"), "A pesquisa não retorna evidências estruturadas");
assert(researchApi.includes("runResearch") && researchApi.includes("browser"), "A pesquisa não usa o orquestrador/navegador");
assert(researchApi.includes("Não encontrei evidências públicas suficientes"), "A pesquisa não possui fallback informativo");
assert(chatUi.includes("web-source-details") && chatUi.includes("Fontes encontradas"), "A pesquisa não mostra fontes em painel recolhível");
assert(chatApi.includes("attachment_signature_invalid"), "A API não rejeita assinatura de anexo inválida");
assert(chatApi.includes("MAX_TOTAL_ATTACHMENT_BYTES"), "A API não limita o tamanho total dos anexos");
assert(chatApi.includes("MAX_IMAGES"), "A API não limita a quantidade de imagens");
assert(chatApi.includes("_kazer-brain") && chatApi.includes("KAZER_BRAIN_VERSION"), "O chat não está conectado ao cérebro KAZER");
assert(chatApi.includes('brain: KAZER_BRAIN_VERSION'), "A resposta não identifica a versão pública kazer.v1");
assert(chatApi.includes("const MAX_MESSAGES = 48"), "A API ainda limita cedo demais o histórico recebido");
assert(chatApi.includes("const CODE_REQUEST_PATTERN") && chatApi.includes("taskType === \"visual\" && !requestedSourceCode"), "Pedidos de código ainda podem receber renderização visual automática");
assert(contextApi.includes("Preserve the opening user turn as an anchor") && contextApi.includes("maxMessages = 32"), "A seleção não preserva o assunto inicial da conversa");
assert(chatUi.includes("Only explicit visual") && chatUi.includes("if (!VISUAL_LANGUAGES.has(normalized)) return null"), "HTML comum ainda pode ser interpretado como visual automaticamente");
assert(chatUi.includes("querySelectorAll(\"style\")") && chatUi.includes("sanitizeVisualStyle(node.textContent)"), "Estilos SVG ricos ainda são removidos durante a sanitização");
assert(instructionsApi.includes("CONTINUIDADE DA CONVERSA") && instructionsApi.includes("não responda com uma saudação genérica"), "O Brain não recebeu instrução explícita de continuidade");
assert(chatUi.includes("selectedFiles = files;"), "O frontend não preserva anexos depois de uma falha");
assert(chatUi.includes("A pessoa mantém o controle da rolagem") && !chatUi.includes("renderAssistantContent(content, text.slice(0, index), { writing: index < total });\n            scrollBottom();"), "A geração ainda força a tela para baixo");
assert(chatUi.includes("A mensagem que falhou continua sendo contexto válido"), "O frontend ainda remove o contexto quando a resposta falha");
assert(!chatUi.includes("conversationMessages.pop();"), "O frontend ainda descarta a mensagem que falhou");
assert(!/voice|microphone|getUserMedia|SpeechRecognition|voiceButton/i.test(chatUi), "A interface ainda contém referências ao microfone");
assert(!chatUi.includes("getUserMedia") && !chatUi.includes("SpeechRecognition"), "O JavaScript ainda tenta acessar o microfone");
assert(!/nexoSkills|NEXO|MENTE|SKILLS|memory|memories|Memória|memórias/.test(chatUi), "A interface ainda contém memória ou NEXO // MENTE & SKILLS");
assert(!chatUi.includes("nexoSkillsButton.addEventListener"), "A opção NEXO // MENTE & SKILLS já possui uma ação antes da hora");
assert(chatUi.includes("installProgress") && chatUi.includes("installCompletionTimer"), "A instalação não possui progresso nem timeout");
assert(chatUi.includes('fetch("/download/android/kazer.apk"') && chatUi.includes('link.download = "kazer.apk"'), "O botão não baixa o APK real");
assert(chatUi.includes("appinstalled") && chatUi.includes("setInstallProgress(100"), "A instalação não confirma conclusão real");
assert(chatUi.includes(".slice(-72)"), "O histórico local ainda é cortado cedo demais ao salvar a conversa");
assert(apk.length > 500000 && apk.subarray(0, 2).toString() === "PK", "O APK release publicado não é um pacote Android válido");
console.log("chat-regression: OK — normalização de conteúdo do provider, contexto, anexos, assinatura, instalação, memória e NEXO removidos, e microfone verificados.");
