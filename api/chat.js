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
const MAX_CODE_OUTPUT_CHARS = 64000;
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
const CODE_REQUEST_PATTERN = /\b(?:index\.html?|index\.htm|\.html?|\.css|\.js|\.ts|\.tsx|\.jsx|\.py|\.sql|\.json|\.md)\b|(?:\b(?:c[oó]digo|code|arquivo|file|script|snippet|trecho|fun[cç][aã]o|function|programa|program|implemente|crie|escreva|mostre|me d[eê])\b[\s\S]{0,100}\b(?:html|css|javascript|typescript|python|sql|json|markdown|c[oó]digo|code)\b)/i;

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
