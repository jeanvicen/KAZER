const DEFAULT_TEXT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";
const DEFAULT_VISION_FALLBACK_MODEL = "qwen/qwen3.6-27b";
const MAX_GROQ_ATTEMPTS_PER_MODEL = 2;
const RETRYABLE_GROQ_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 32000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 3;
const MAX_EXTRACTED_FILE_CHARS = 18000;

const SYSTEM_PROMPT = [
  "Você é o assistente do KAZER.",
  "Responda em português brasileiro, a menos que o usuário peça outro idioma.",
  "Seja claro, útil e direto. Organize respostas longas com títulos curtos e listas quando isso melhorar a leitura.",
  "Não invente fatos. Quando não tiver informações suficientes, diga o que falta e faça uma pergunta objetiva.",
  "Quando receber imagens, descreva apenas o que conseguir observar e sinalize incertezas.",
  "Quando receber arquivos, use o conteúdo extraído como fonte e informe se o formato não puder ser lido.",
].join(" ");

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers["x-forwarded-host"];
    const requestHost = (forwardedHost || request.headers.host || "").split(",")[0].trim();
    return Boolean(requestHost) && originUrl.host === requestHost;
  } catch {
    return false;
  }
}

function parseMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;

  let totalChars = 0;
  const messages = [];

  for (const item of value) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;

    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;

    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: item.role, content });
  }

  if (messages[messages.length - 1]?.role !== "user") return null;
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
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .trim();
}

function isTextFile(attachment, parsed) {
  if (parsed.mimeType.startsWith("text/")) return true;
  const name = String(attachment.name || "").toLowerCase();
  return /\.(txt|md|csv|json|xml|html|htm|js|ts|tsx|jsx|css|py|java|sql|yaml|yml|log)$/i.test(name);
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
  if (!Array.isArray(attachments) || attachments.length > 5) throw new Error("attachments_invalid");

  const imageParts = [];
  const fileSections = [];
  const fileNames = [];

  for (const attachment of attachments) {
    if (!attachment || typeof attachment.name !== "string" || typeof attachment.data !== "string") {
      throw new Error("attachment_invalid");
    }

    const parsed = parseDataUrl(attachment.data);
    if (!parsed) throw new Error("attachment_invalid");
    fileNames.push(attachment.name.slice(0, 120));

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
      extractedText = await extractFileText(attachment, parsed);
    } catch (error) {
      console.error("File extraction failed", { name: attachment.name, error: error?.message || "unknown" });
    }

    if (extractedText) {
      fileSections.push(`Arquivo: ${attachment.name}\nConteúdo extraído:\n${extractedText}`);
    } else {
      fileSections.push(`Arquivo: ${attachment.name}\nNão foi possível extrair texto deste formato no servidor.`);
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

async function callGroq({ apiKey, models, messages, hasImages }) {
  let lastFailure = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_GROQ_ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        const requestBody = {
          model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          temperature: hasImages ? 0.7 : 0.6,
          max_completion_tokens: 1200,
        };

        // GPT OSS aceita níveis como medium; os modelos Qwen exigem none/default.
        if (!model.startsWith("qwen/")) {
          requestBody.reasoning_effort = process.env.GROQ_REASONING_EFFORT || "medium";
        }

        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const data = await groqResponse.json().catch(() => null);
        if (groqResponse.ok) return { data, model };

        lastFailure = {
          status: groqResponse.status,
          model,
          error: data?.error?.message || "unknown",
        };

        if (!RETRYABLE_GROQ_STATUSES.has(groqResponse.status)) break;
      } catch (error) {
        lastFailure = { status: 0, model, error: error?.message || "network_error" };
      }

      if (attempt < MAX_GROQ_ATTEMPTS_PER_MODEL - 1) {
        await wait(250 * 2 ** attempt);
      }
    }
  }

  return { failure: lastFailure };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }

  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: "Origem não autorizada." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY não configurada no ambiente do servidor.");
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

  const messages = parseMessages(body?.messages);
  if (!messages) {
    return sendJson(response, 400, { error: "Histórico de conversa inválido." });
  }

  let prepared;
  try {
    prepared = await prepareAttachments(body?.attachments);
  } catch (error) {
    const status = ["too_many_images", "image_type_invalid", "attachments_invalid", "attachment_invalid"].includes(error.message) ? 400 : 422;
    return sendJson(response, status, { error: "Um ou mais anexos não puderam ser processados." });
  }

  const hasImages = prepared.imageParts.length > 0;
  const models = hasImages
    ? [
        process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL,
        process.env.GROQ_VISION_FALLBACK_MODEL || DEFAULT_VISION_FALLBACK_MODEL,
      ].filter((value, index, values) => values.indexOf(value) === index)
    : [process.env.GROQ_MODEL || DEFAULT_TEXT_MODEL];
  const lastMessage = messages[messages.length - 1];
  const fileInstruction = prepared.fileContext
    ? `\n\nUse os anexos abaixo como contexto para responder:\n\n${prepared.fileContext}`
    : "";
  const latestText = `${lastMessage.content}${fileInstruction}`.slice(0, MAX_TOTAL_CHARS);
  const latestContent = hasImages
    ? [{ type: "text", text: latestText }, ...prepared.imageParts]
    : latestText;
  const apiMessages = [
    ...messages.slice(0, -1),
    { role: "user", content: latestContent },
  ];

  const result = await callGroq({ apiKey, models, messages: apiMessages, hasImages });
  if (result.failure) {
    console.error("Groq request failed", result.failure);
    return sendJson(response, 502, { error: "A Groq não conseguiu responder agora. Tente novamente." });
  }

  const { data, model } = result;
  const content = cleanModelContent(data?.choices?.[0]?.message?.content);
  if (!content) {
      console.error("Groq returned an empty response", { model });
      return sendJson(response, 502, { error: "A resposta recebida estava vazia. Tente novamente." });
    }

  return sendJson(response, 200, {
    model,
    message: { role: "assistant", content: content.trim() },
    attachments: prepared.fileNames,
  });
};
