const TASK_PATTERNS = {
  visual: /\b(?:imagem|visual|desenho|logo|ícone|layout|interface|tela|protótipo|mockup|wireframe|diagrama|fluxograma|gráfico|dashboard|slide|banner|design|visual)\b/i,
  coding: /\b(?:código|codigo|programa|programar|bug|erro|refator|função|funcao|api|javascript|typescript|python|sql|html|css|commit|deploy|repositório|repositorio)\b/i,
  analysis: /\b(?:analise|análise|compare|comparar|auditoria|investigue|explique em detalhes|avalie|revisão|revisao)\b/i,
};

function classifyTask(text, { hasImages = false, hasFiles = false, hasTools = false } = {}) {
  const value = String(text || "");
  if (hasImages) return "vision";
  if (TASK_PATTERNS.visual.test(value)) return "visual";
  if (TASK_PATTERNS.coding.test(value)) return "coding";
  if (TASK_PATTERNS.analysis.test(value) || hasFiles || hasTools) return "analysis";
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

module.exports = { classifyTask, selectConversationMessages };
