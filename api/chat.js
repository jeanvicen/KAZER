/*
 * KAZER — Copyright © 2026 Jean V. / @jeanvicen · 0neajx · KLYPZA.
 * Código proprietário. Consulte /LICENSE.md antes de reutilizar este arquivo.
 */
const {
  applyRateLimit,
  authenticateUser,
  hasSafeFetchMetadata,
  isSameOrigin,
  rateLimit,
  readTextWithLimit,
  redactSensitiveText,
  requestExceedsLimit,
  sendJson,
} = require("./_security");
const { callUsageRpc, calculateChatCreditCost } = require("./_usage");
const { callMcpTool, flattenTools, getConnectedMcpCount, loadMcpRuntime } = require("./_mcp-runtime");
const { decodeToken, getConnection, githubFetch, repoForClient } = require("./_github");
const { supabaseRequest } = require("./_kazer-data");
const { KAZER_BRAIN_VERSION, callKazerBrain } = require("./_kazer-brain");
const { researchToolDefinition, runResearch } = require("./_research-orchestrator");
const { currentBrazilContext, needsRealtimeResearch, researchContextText } = require("./_realtime-context");

const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 16000;
const MAX_GROQ_ATTEMPTS_PER_MODEL = 2;
const RETRYABLE_GROQ_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_MESSAGES = 48;
const MAX_RECEIVED_MESSAGES = 72;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 32000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 3;
const MAX_EXTRACTED_FILE_CHARS = 18000;

const { buildSystemInstructions } = require("./_kazer-instructions");
const { classifyTask, planTask, selectConversationMessages, validateToolRequest } = require("./_kazer-context");
const VISUAL_REQUEST_PATTERN = /\b(?:imagem|visual|desenho|desenhar|ilustra[cç][aã]o|logo|[ií]cone|[ií]cones|layout|interface|tela|prot[oó]tipo|mockup|wireframe|diagrama|fluxograma|gr[aá]fico|chart|dashboard|slide|cart[aã]o|banner|poster|p[oó]ster|infogr[aá]fico|planta|mapa|composi[cç][aã]o|design|image|drawing|illustration|icon|icons|screen|prototype|mockup|wireframe|diagram|flowchart|chart|dashboard|slide|card|banner|poster|infographic|visual(?:ly)?|look like)\b/i;

const MODERATION_PATTERNS = [
  /\b(?:como|passo a passo|instru[cç][oõ]es|ensine|fabricar|montar|construir|detonar|envenenar|hackear|invadir|roubar|matar|burlar)\b[\s\S]{0,100}\b(?:bomba|explosivo|arma|veneno|malware|ransomware|senha|cart[aã]o|conta|v[ií]tima|pol[ií]cia|crime)\b/i,
  /\b(?:fabricar|montar|construir|comprar|detonar)\b[\s\S]{0,60}\b(?:bomba|explosivo|arma)\b/i,
  /\b(?:filho da puta|vai tomar no cu|puta que pariu|arrombado)\b/i,
];

function cleanUserContent(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function normalizeRepositoryContext(value) {
  if (!value || typeof value !== "object") return null;
  const fullName = cleanUserContent(value.fullName).slice(0, 160);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null;
  let htmlUrl = "";
  try {
    const url = new URL(String(value.htmlUrl || ""));
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    htmlUrl = `https://github.com/${fullName}`;
  } catch {
    return null;
  }
  return {
    fullName,
    htmlUrl,
    defaultBranch: cleanUserContent(value.defaultBranch || "main").slice(0, 120),
    language: cleanUserContent(value.language || "").slice(0, 80) || null,
  };
}

async function resolveRepositoryContext(userId, value) {
  const candidate = normalizeRepositoryContext(value);
  if (!candidate) return null;
  const connection = await getConnection(userId).catch(() => null);
  const token = decodeToken(connection);
  if (!token) return null;
  const [owner, name] = candidate.fullName.split("/");
  try {
    const repo = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
    return normalizeRepositoryContext(repoForClient(repo));
  } catch {
    return null;
  }
}

function isModeratedRequest(messages) {
  const latest = messages[messages.length - 1]?.content || "";
  return MODERATION_PATTERNS.some((pattern) => pattern.test(latest));
}

function parseMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECEIVED_MESSAGES) return null;

  let totalChars = 0;
  const messages = [];
  const recentMessages = value.slice(-MAX_MESSAGES);

  for (const item of recentMessages) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;

    const content = cleanUserContent(item.content);
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    if (item.role === "assistant" && /^(?:O KAZER não conseguiu concluir a resposta agora\. Tente novamente\.|A resposta recebida estava vazia\. Tente novamente\.|Não foi possível conectar ao chat agora\.)$/i.test(content)) continue;

    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: item.role, content });
  }

  if (messages[messages.length - 1]?.role !== "user") return null;
  return messages;
}

function parseTitleMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECEIVED_MESSAGES) return null;
  let totalChars = 0;
  const messages = [];
  for (const item of value.slice(-MAX_MESSAGES)) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;
    const content = cleanUserContent(item.content);
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: item.role, content });
  }
  return messages;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) return null;

  return { mimeType, buffer, dataUrl };
}

function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_FILE_CHARS);
}

function cleanModelContent(value) {
  return redactSensitiveText(String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .trim())
    .slice(0, MAX_OUTPUT_CHARS)
    .trim();
}

function protectKazerIdentity(value) {
  const blockedProviders = /\b(?:openai|chatgpt|gpt(?:-[a-z0-9.]+)?|groq|qwen|llama|anthropic|claude|gemini|google ai|mistral)\b/i;
  const internalDisclosure = /\b(?:api|modelo de linguagem|provedor|fornecedor|infraestrutura|treinad[oa]|conhecimento vai até|data de corte|base de conhecimento|serviço por trás|desenvolvid[oa] por)\b/i;
  const fallback = "Sou o KAZER, seu assistente. Posso ajudar com dúvidas, explicações, textos, ideias e tarefas práticas.";
  const protectText = (text) => String(text || "")
    .split(/(?<=[.!?])\s+|\n(?=\S)/)
    .map((sentence) => {
      const trimmed = sentence.trim();
      if (!trimmed) return sentence;
      if (blockedProviders.test(trimmed)) return fallback;
      if (internalDisclosure.test(trimmed) && /\b(?:sou|fui|uso|utilizo|funciono|funciona|integrad[oa]|por trás|desenvolvid[oa])\b/i.test(trimmed)) return fallback;
      return sentence;
    })
    .join(" ")
    .replace(/[ \t]{2,}/g, " ");

  const source = String(value || "");
  const fencedPattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  let cursor = 0;
  let match;
  let result = "";
  while ((match = fencedPattern.exec(source))) {
    result += protectText(source.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  result += protectText(source.slice(cursor));
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function cleanFileName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .slice(0, 120) || "anexo";
}

function isTextFile(attachment, parsed) {
  if (parsed.mimeType.startsWith("text/")) return true;
  const name = String(attachment.name || "").toLowerCase();
  return /\.(txt|md|csv|json|xml|html|htm|js|ts|tsx|jsx|css|py|java|sql|yaml|yml|log)$/i.test(name);
}

function isAllowedAttachment(attachment, parsed) {
  if (parsed.mimeType.startsWith("image/")) return true;
  if (isTextFile(attachment, parsed)) return true;
  if (parsed.mimeType === "application/pdf" || parsed.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return /\.(pdf|docx)$/i.test(String(attachment.name || ""));
}
function hasExpectedFileSignature(mimeType, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/gif") return buffer.subarray(0, 4).toString("ascii") === "GIF8";
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return true;
}

async function extractFileText(attachment, parsed) {
  if (isTextFile(attachment, parsed)) {
    return cleanExtractedText(parsed.buffer.toString("utf8"));
  }

  if (parsed.mimeType === "application/pdf" || String(attachment.name || "").toLowerCase().endsWith(".pdf")) {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(parsed.buffer);
    return cleanExtractedText(result.text);
  }

  if (
    parsed.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    String(attachment.name || "").toLowerCase().endsWith(".docx")
  ) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer: parsed.buffer });
    return cleanExtractedText(result.value);
  }

  return "";
}

async function prepareAttachments(attachments) {
  if (attachments == null) return { imageParts: [], fileContext: "", fileNames: [] };
  if (!Array.isArray(attachments) || attachments.length > 10) throw new Error("attachments_invalid");

  const imageParts = [];
  const fileSections = [];
  const fileNames = [];
  let totalAttachmentBytes = 0;

  for (const attachment of attachments) {
    if (!attachment || typeof attachment.name !== "string" || typeof attachment.data !== "string") {
      throw new Error("attachment_invalid");
    }

    const safeAttachment = { ...attachment, name: cleanFileName(attachment.name) };
    const parsed = parseDataUrl(safeAttachment.data);
    if (!parsed || !isAllowedAttachment(safeAttachment, parsed)) throw new Error("attachment_type_invalid");
    if (!isTextFile(safeAttachment, parsed) && !hasExpectedFileSignature(parsed.mimeType, parsed.buffer)) throw new Error("attachment_signature_invalid");
    totalAttachmentBytes += parsed.buffer.length;
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("attachments_too_large");
    fileNames.push(safeAttachment.name);

    if (parsed.mimeType.startsWith("image/")) {
      if (imageParts.length >= MAX_IMAGES) throw new Error("too_many_images");
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(parsed.mimeType)) {
        throw new Error("image_type_invalid");
      }
      imageParts.push({
        type: "image_url",
        image_url: { url: parsed.dataUrl },
      });
      continue;
    }

    let extractedText = "";
    try {
      extractedText = await extractFileText(safeAttachment, parsed);
    } catch (error) {
      console.error("File extraction failed", { error: error?.message || "unknown" });
    }

    if (extractedText) {
      fileSections.push(`Arquivo: ${safeAttachment.name}\nConteúdo extraído:\n${extractedText}`);
    } else {
      fileSections.push(`Arquivo: ${safeAttachment.name}\nNão foi possível extrair texto deste formato no servidor.`);
    }
  }

  return {
    imageParts,
    fileContext: fileSections.join("\n\n---\n\n"),
    fileNames,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callGroq({ messages, hasImages, tools = [], timeoutMs = 30_000, maxAttempts = MAX_GROQ_ATTEMPTS_PER_MODEL, runtimeContext = "", taskType = "conversation", hasFiles = false, hasRepository = false, capabilities = [] }) {
  const latest = messages.at(-1)?.content;
  const inferredTask = taskType === "conversation" ? classifyTask(typeof latest === "string" ? latest : "", { hasImages, hasFiles, hasTools: tools.length > 0 }) : taskType;
  const systemContent = buildSystemInstructions({ taskType: inferredTask, hasImages, hasFiles, hasTools: tools.length > 0, hasRepository, runtimeContext });
  return callKazerBrain({
    messages: [{ role: "system", content: systemContent }, ...messages],
    hasImages,
    tools,
    timeoutMs,
    maxAttempts,
    taskType: inferredTask,
    capabilities,
  });
}

async function callGroqWithMcp({ messages, hasImages, mcpServers, runtimeContext = "", hasFiles = false, hasRepository = false, taskType = "conversation", capabilityPlan = null }) {
  const { tools: mcpTools, byName } = flattenTools(mcpServers || []);
  const tools = [...(capabilityPlan?.needsResearch ? [researchToolDefinition] : []), ...mcpTools];
  let currentMessages = [...messages];
  let result = await callGroq({ messages: currentMessages, hasImages, tools, runtimeContext, hasFiles, hasRepository, taskType, capabilities: capabilityPlan?.capabilities || [] });
  if (result.failure || !tools.length) return { ...result, mcpToolsUsed: 0, researchUsed: 0 };

  let toolsUsed = 0;
  let researchUsed = 0;
  for (let round = 0; round < 5; round += 1) {
    const assistantMessage = result.data?.choices?.[0]?.message;
    const toolCalls = Array.isArray(assistantMessage?.tool_calls) ? assistantMessage.tool_calls.slice(0, 6) : [];
    if (!toolCalls.length) break;
    currentMessages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: toolCalls,
    });
    for (const toolCall of toolCalls) {
      const name = toolCall?.function?.name;
      const entry = byName.get(name);
      let toolContent = "Ferramenta indisponível.";
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
        const validation = validateToolRequest(name, parsedArgs);
        if (!validation.ok) throw new Error(validation.error);
        const args = validation.args;
        if (name === researchToolDefinition.function.name) {
          const research = await runResearch({ question: args.question, deep: args.depth !== "normal" });
          toolContent = JSON.stringify({ question: research.question, queries: research.queries, sources: research.sources, evidence: research.evidence, visitedUrls: research.visitedUrls, browserAvailable: research.browserAvailable, errors: research.errors, stopReason: research.stopReason }).slice(0, 42_000);
          researchUsed += 1;
        } else if (entry) {
          toolContent = await callMcpTool(entry, args);
          toolsUsed += 1;
        }
      } catch (error) {
        toolContent = `Falha ao consultar a ferramenta: ${String(error?.message || "erro").slice(0, 300)}`;
      }
      currentMessages.push({ role: "tool", tool_call_id: toolCall.id, content: toolContent });
    }
    result = await callGroq({ messages: currentMessages, hasImages: false, tools, runtimeContext, hasFiles, hasRepository, taskType, capabilities: capabilityPlan?.capabilities || [] });
    if (result.failure) break;
  }
  return { ...result, mcpToolsUsed: toolsUsed, researchUsed };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }

  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) {
    return sendJson(response, 403, { error: "Origem não autorizada." });
  }
  if (requestExceedsLimit(request, MAX_REQUEST_BYTES)) {
    return sendJson(response, 413, { error: "O conteúdo enviado excede o limite permitido." });
  }

  const preAuthLimit = rateLimit(request, "chat-ip", { limit: 8, windowMs: 60_000 });
  preAuthLimit.limit = 8;
  applyRateLimit(response, preAuthLimit);
  if (!preAuthLimit.allowed) {
    return sendJson(response, 429, { error: "Muitas tentativas. Aguarde um momento e tente novamente." });
  }

  const user = await authenticateUser(request);
  if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });

  const userLimit = rateLimit(request, "chat-user", { limit: 12, windowMs: 60_000, identity: user.id });
  userLimit.limit = 12;
  applyRateLimit(response, userLimit);
  if (!userLimit.allowed) {
    return sendJson(response, 429, { error: "Limite de mensagens atingido. Aguarde um minuto." });
  }

  if (!process.env.HF_TOKEN && !process.env.GROQ_API_KEY) {
    console.error("Nenhum provedor do cérebro KAZER está configurado no ambiente do servidor.");
    return sendJson(response, 500, { error: "O serviço de chat ainda não foi configurado." });
  }

  let body = request.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(response, 400, { error: "JSON inválido." });
    }
  }

  if (Buffer.byteLength(JSON.stringify(body || {}), "utf8") > MAX_REQUEST_BYTES) {
    return sendJson(response, 413, { error: "O conteúdo enviado excede o limite permitido." });
  }

  const messages = parseMessages(body?.messages);
  if (body?.purpose === "title") {
    const titleMessages = parseTitleMessages(body?.messages);
    if (!titleMessages) return sendJson(response, 400, { error: "Conversa inválida para gerar título." });
    const titlePrompt = [{ role: "user", content: "Crie um título curto para esta conversa. Responda SOMENTE com o título, em português, com no máximo 6 palavras, sem aspas, sem ponto final e sem explicações. O título deve representar o objetivo principal do usuário, não copiar literalmente a primeira mensagem.\n\nConversa:\n" + titleMessages.map((item) => `${item.role === "user" ? "Usuário" : "KAZER"}: ${item.content}`).join("\n").slice(0, 6000) }];
    const result = await callGroq({ messages: titlePrompt, hasImages: false, timeoutMs: 12_000 });
    if (result.failure) return sendJson(response, 502, { error: "Não foi possível gerar o título agora." });
    const title = cleanModelContent(result.data?.choices?.[0]?.message?.content).replace(/[\r\n]+/g, " ").replace(/^['"“”]+|['"“”]+$/g, "").trim().slice(0, 72);
    if (!title) return sendJson(response, 502, { error: "O título gerado estava vazio." });
    return sendJson(response, 200, { title });
  }
  if (!messages) {
    return sendJson(response, 400, { error: "Histórico de conversa inválido." });
  }
  const repositoryContext = await resolveRepositoryContext(user.id, body?.githubRepo);
  if (isModeratedRequest(messages)) {
    return sendJson(response, 422, { error: "Não posso processar esse conteúdo. Reformule o pedido de forma segura e respeitosa." });
  }

  let prepared;
  try {
    prepared = await prepareAttachments(body?.attachments);
  } catch (error) {
    const status = ["too_many_images", "image_type_invalid", "attachment_type_invalid", "attachment_signature_invalid", "attachments_invalid", "attachment_invalid"].includes(error.message) ? 400 : error.message === "attachments_too_large" ? 413 : 422;
    return sendJson(response, status, { error: "Um ou mais anexos não puderam ser processados." });
  }

  const lastMessage = messages[messages.length - 1];
  const requestedMcpCount = await getConnectedMcpCount(user.id, body?.mcpConnectorIds);
  const capabilityPlan = planTask(lastMessage.content, { hasImages: prepared.imageParts.length > 0, hasFiles: prepared.fileNames.length > 0, hasTools: requestedMcpCount > 0, hasRepository: Boolean(repositoryContext) });
  const { taskType } = capabilityPlan;
  const creditCost = calculateChatCreditCost(messages, prepared.fileNames.length, requestedMcpCount);
  let usage;
  try {
    usage = await callUsageRpc(request, "consume_kazer_usage", {
      p_message_count: 1,
      p_attachment_count: prepared.fileNames.length,
    });
  } catch (initialError) {
    let error = initialError;
    if (initialError.status === 404 || (initialError.status === 400 && initialError.code === "usage_rpc_failed")) {
      try {
        usage = await callUsageRpc(request, "consume_chat_usage", {
          p_credit_amount: creditCost,
          p_attachment_count: prepared.fileNames.length,
        });
        error = null;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }
    if (!error) {
      // Compatibilidade temporária com ambientes que ainda não aplicaram a migração mensal.
    } else if (error.code === "usage_limit_reached") {
      return sendJson(response, 402, {
        error: "Seu uso mensal chegou a 100%. As mensagens e os anexos serão liberados no primeiro dia do próximo mês.",
        usage: { usage_limit_reached: true, credits_limit_reached: true },
      });
    } else {
      console.error("Usage reservation failed", error?.message || "unknown");
      return sendJson(response, 503, { error: "Não foi possível validar os limites da conta agora." });
    }
  }

  const mcpServers = await loadMcpRuntime(user.id, body?.mcpConnectorIds);
  const hasImages = prepared.imageParts.length > 0;
  const fileInstruction = prepared.fileContext
    ? `\n\nUse os anexos abaixo como contexto para responder:\n\n${prepared.fileContext}`
    : "";
  const visualInstruction = VISUAL_REQUEST_PATTERN.test(String(lastMessage.content || ""))
    ? "\n\nINSTRUÇÃO DE RENDERIZAÇÃO: este pedido tem intenção visual. Entregue o resultado visual dentro da resposta usando um bloco ```kazer-svg ou ```kazer-html. Não devolva o SVG/HTML como bloco de código comum, não use mermaid e não entregue apenas instruções para o usuário executar. Intercale uma explicação curta com o visual renderizável."
    : "";
  const repositoryInstruction = repositoryContext
    ? `\n\nCONTEXTO DE REPOSITÓRIO AUTORIZADO: a pessoa selecionou ${repositoryContext.fullName} (${repositoryContext.htmlUrl}), branch padrão ${repositoryContext.defaultBranch}${repositoryContext.language ? ` e linguagem principal ${repositoryContext.language}` : ""}. Use esse contexto para responder sobre o trabalho pedido; não invente acesso a arquivos ou ações concluídas.`
    : "";
  const latestText = `${lastMessage.content}${repositoryInstruction}${visualInstruction}${fileInstruction}`.slice(0, MAX_TOTAL_CHARS);
  const latestContent = hasImages
    ? [{ type: "text", text: latestText }, ...prepared.imageParts]
    : latestText;
  const selectedHistory = selectConversationMessages(messages);
  const apiMessages = [
    ...selectedHistory.slice(0, -1),
    { role: "user", content: latestContent },
  ];

  const realtimeRequested = !hasImages && needsRealtimeResearch(lastMessage.content);
  let runtimeContext = currentBrazilContext();
  let forcedResearchUsed = 0;
  if (realtimeRequested) {
    try {
      const realtimeResearch = await runResearch({
        question: lastMessage.content,
        deep: true,
        maxSearches: 6,
        maxPages: 6,
        maxActions: 24,
      });
      runtimeContext += `\n\n${researchContextText(realtimeResearch, redactSensitiveText)}\n\nA pesquisa atual já foi executada no servidor. Não faça uma segunda pesquisa para esta mesma pergunta, a menos que as evidências estejam vazias.`;
      forcedResearchUsed = 1;
    } catch (error) {
      runtimeContext += "\n\nPESQUISA ATUAL OBRIGATÓRIA: a tentativa de consulta falhou. Não invente fatos recentes; informe que não foi possível verificar agora.";
      console.error("Realtime research preflight failed", error?.message || "unknown");
    }
  }

  const result = await callGroqWithMcp({ messages: apiMessages, hasImages, mcpServers, runtimeContext, hasFiles: prepared.fileNames.length > 0, hasRepository: Boolean(repositoryContext), taskType, capabilityPlan });
  if (result.failure) {
    console.error("Groq request failed", result.failure);
    return sendJson(response, 502, { error: "O KAZER não conseguiu concluir a resposta agora. Tente novamente." });
  }

  const { data, model } = result;
  const content = protectKazerIdentity(cleanModelContent(data?.choices?.[0]?.message?.content));
  if (!content) {
      console.error("Groq returned an empty response", { model });
      return sendJson(response, 502, { error: "A resposta recebida estava vazia. Tente novamente." });
    }

  return sendJson(response, 200, {
    brain: KAZER_BRAIN_VERSION,
    message: { role: "assistant", content: content.trim() },
    attachments: prepared.fileNames,
    usage,
    credit_cost: creditCost,
    mcp_connector_count: requestedMcpCount,
    mcp_servers_available: mcpServers.length,
    mcp_tools_used: result.mcpToolsUsed || 0,
    research_used: (result.researchUsed || 0) + forcedResearchUsed,
    repository_context: repositoryContext?.fullName || null,
  });
};
