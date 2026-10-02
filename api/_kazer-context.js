const TASK_PATTERNS = {
  visual: /\b(?:imagem|visual|desenho|logo|ícone|layout|interface|tela|protótipo|mockup|wireframe|diagrama|fluxograma|gráfico|dashboard|slide|banner|design|visual)\b/i,
  coding: /\b(?:código|codigo|programa|programar|bug|erro|refator|função|funcao|function|api|javascript|typescript|python|sql|html|css|commit|deploy)\b/i,
  analysis: /\b(?:analise|análise|analyze|analyse|compare|comparar|auditoria|audit|investigue|investigate|explique em detalhes|avalie|revisão|revisao|review|diagnose|diagnostique)\b/i,
};
const ENGINEERING_REQUEST = /\b(?:build|create|implement|write|develop|add|integrate|fix|debug|refactor|repair|change|update|make|construa|crie|implemente|escreva|desenvolva|adicione|integre|corrija|depure|refatore|conserte|altere|atualize)\b[\s\S]{0,180}\b(?:system|application|app|software|website|web\s*site|api|endpoint|authentication|authorization|auth|login|session|backend|back-end|frontend|front-end|database|schema|integration|repository|repo|codebase|function|code|bug|error|crash|test|script|component|module|server|dashboard|sistema|aplicativo|aplicação|software|site|autenticação|autorização|sessão|banco de dados|integração|repositório|função|código|erro|teste|componente|módulo|servidor|painel)\b/i;
const DEBUGGING_QUESTION = /\b(?:why|what(?:'s| is) wrong|help me (?:understand|debug)|por que|o que (?:está|esta) errado|me ajude a entender)\b[\s\S]{0,140}\b(?:function|code|script|api|app|server|repository|repo|função|código|script|aplicativo|servidor|repositório)\b[\s\S]{0,100}\b(?:crash(?:ing|ed)?|fail(?:ing|ed)?|break(?:ing)?|error|exception|not work(?:ing)?|trav(?:a|ando)|falh(?:a|ando)|erro|quebr(?:a|ando))\b/i;
const BUG_FIX_REQUEST = /\b(?:find|fix|debug|repair|corrija|corrigir|conserte|depure|resolva)\b[\s\S]{0,100}\b(?:bug|error|issue|problem|crash|erro|falha|problema|código|codigo|function|função)\b/i;
const MULTI_STEP_REQUIREMENT = /\b(?:and|e)\b\s+(?:also\s+)?(?:then|make sure|ensure|verify|check|test|keep|preserve|include|confirm|guarantee|também|garanta|verifique|confira|teste|mantenha|preserve|inclua|confirme|valide)\b/i;

function classifyTask(text, { hasImages = false, hasFiles = false, hasTools = false } = {}) {
  const value = String(text || "");
  if (hasImages) return "vision";
  if (ENGINEERING_REQUEST.test(value) || DEBUGGING_QUESTION.test(value) || BUG_FIX_REQUEST.test(value) || TASK_PATTERNS.coding.test(value)) return "coding";
  if (TASK_PATTERNS.analysis.test(value)) return "analysis";
  if (TASK_PATTERNS.visual.test(value)) return "visual";
  if (hasFiles || hasTools) return "analysis";
  return "conversation";
}

function selectConversationMessages(messages, { maxMessages = 18, maxChars = 22000 } = {}) {
  if (!Array.isArray(messages) || !messages.length) return [];
  const latest = messages.at(-1);
  const selected = [latest];
  let chars = String(latest?.content || "").length;
  for (let index = messages.length - 2; index >= 0 && selected.length < maxMessages; index -= 1) {
    const candidate = messages[index];
    const candidateChars = String(candidate?.content || "").length;
    if (chars + candidateChars > maxChars) break;
    selected.unshift(candidate);
    chars += candidateChars;
  }
  return selected;
}

function planTask(text, { hasImages = false, hasFiles = false, hasTools = false, hasRepository = false } = {}) {
  const value = String(text || "").trim();
  const taskType = classifyTask(value, { hasImages, hasFiles, hasTools });
  const needsResearch = /\b(?:pesquis[ae]|pesquisar|investigue|fontes|notícias|noticia|atual|hoje|agora|latest|research|sources|news|compare preços|compare precos)\b/i.test(value);
  const needsValidation = /\b(?:teste|testes|valid[ae]|verifique|revis[ae]|corrija|fix|debug|bug|build|deploy)\b/i.test(value) || taskType === "coding";
  const multiStep = /\b(?:depois|em seguida|então|entao|primeiro|segundo|por fim|and then|after that|first|then|finally)\b/i.test(value) || MULTI_STEP_REQUIREMENT.test(value) || /\b(?:e|and)\b[\s\S]{3,}\b(?:e|and)\b/i.test(value);
  const constraints = [...new Set([
    /\b(?:não|nao|don't|do not)\b[\s\S]{0,100}/i.exec(value)?.[0],
    /\b(?:somente|só|so|apenas|only)\b[\s\S]{0,80}/i.exec(value)?.[0],
  ].filter(Boolean).map((item) => item.trim().slice(0, 180)))];
  const capabilities = [];
  if (taskType === "coding") capabilities.push("coding");
  if (taskType === "analysis") capabilities.push("analysis");
  if (hasImages) capabilities.push("vision");
  if (hasFiles) capabilities.push("file_analysis");
  if (hasRepository) capabilities.push("repository_context");
  if (needsResearch) capabilities.push("research");
  if (hasTools) capabilities.push("tools");
  if (needsValidation) capabilities.push("validation");
  return {
    taskType,
    complexity: multiStep || capabilities.length >= 3 ? "complex" : (capabilities.length ? "focused" : "simple"),
    capabilities,
    needsResearch,
    needsValidation,
    multiStep,
    constraints,
  };
}

function validateToolRequest(name, args) {
  if (!name || !args || typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "tool_arguments_invalid" };
  if (JSON.stringify(args).length > 12_000) return { ok: false, error: "tool_arguments_too_large" };
  if (name === "research_web") {
    const question = String(args.question || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
    if (question.length < 2) return { ok: false, error: "research_question_invalid" };
    return { ok: true, args: { question, depth: args.depth === "deep" ? "deep" : "normal" } };
  }
  return { ok: true, args };
}

module.exports = { classifyTask, planTask, selectConversationMessages, validateToolRequest };
