import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const chatApi = await readFile(`${root}/api/chat.js`, "utf8");
const chatUi = await readFile(`${root}/interface/chat.html`, "utf8");
const searchApi = await readFile(`${root}/api/web-search.js`, "utf8");
const driveApi = await readFile(`${root}/api/google-drive.js`, "utf8");
const tasksMigration = await readFile(`${root}/database/supabase/010_mcp_github_tasks.sql`, "utf8");
const cleanupMigration = await readFile(`${root}/database/supabase/018_remove_consumption_controls.sql`, "utf8");
const apk = await readFile(`${root}/download/android/kazer.apk`);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

execFileSync(process.execPath, ["--check", `${root}/api/chat.js`]);
assert(chatApi.includes("authenticateUser") && chatApi.includes("MAX_REQUEST_BYTES"), "A API não mantém autenticação e limite técnico de corpo");
assert(!/attachment|attachments|credit_cost|credits_balance|consume_.*usage/i.test(chatApi), "A API de chat ainda contém lógica de anexos ou consumo");
assert(!/attachment|attachments|credit_cost|credits_balance|consume_.*usage/i.test(searchApi), "A API de pesquisa ainda contém lógica de consumo");
assert(!/callUsageRpc|credit|usage/i.test(driveApi), "A API do Google Drive ainda contém cobrança por uso");
assert(!chatUi.includes("selectedFiles") && !chatUi.includes("attachmentSheet") && !chatUi.includes("plansScreen"), "A interface ainda contém superfícies de anexos ou planos");
assert(chatUi.includes('id="connectorsScreen"') && chatUi.includes("window.kazerOpenConnectorsScreen"), "O acesso aos conectores foi removido junto com anexos");
assert(chatUi.includes("A mensagem que falhou continua sendo contexto válido"), "O frontend ainda remove o contexto quando a resposta falha");
assert(!chatUi.includes("conversationMessages.pop();"), "O frontend ainda descarta a mensagem que falhou");
assert(!/voice|microphone|getUserMedia|SpeechRecognition|voiceButton/i.test(chatUi), "A interface ainda contém referências ao microfone");
assert(!chatUi.includes('id="nexoSkillsButton"') && chatUi.includes('id="nexoSkillsNavButton"') && chatUi.includes("NEXO // MENTE &amp; SKILLS"), "A opção NEXO // MENTE & SKILLS não está somente na lista lateral");
assert(!chatUi.includes("nexoSkillsButton.addEventListener"), "A opção NEXO // MENTE & SKILLS já possui uma ação antes da hora");
assert(chatUi.includes("installProgress") && chatUi.includes("installCompletionTimer"), "A instalação não possui progresso nem timeout");
assert(chatUi.includes('fetch("/download/android/kazer.apk"') && chatUi.includes('link.download = "kazer.apk"'), "O botão não baixa o APK real");
assert(chatUi.includes("appinstalled") && chatUi.includes("setInstallProgress(100"), "A instalação não confirma conclusão real");
assert(!tasksMigration.includes("credit_cost") && !tasksMigration.includes("consume_kazer_usage"), "A migração de tarefas ainda contém metadados de cobrança");
assert(cleanupMigration.includes("drop table if exists public.user_usage cascade") && cleanupMigration.includes("drop column if exists credit_cost"), "A migração corretiva não remove as estruturas antigas");
assert(apk.length > 500000 && apk.subarray(0, 2).toString() === "PK", "O APK release publicado não é um pacote Android válido");
console.log("chat-regression: OK — chat textual, conectores, contexto de falha, instalação e limpeza de consumo verificados.");
