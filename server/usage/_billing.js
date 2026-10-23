/*
 * KAZER Pro — cobrança PIX via Abacate Pay.
 * 1. POST /api/billing/checkout cria a cobrança e devolve a URL de pagamento.
 * 2. A Abacate Pay chama /api/billing/webhook?webhookSecret=… em billing.paid.
 * 3. O webhook confirma a cobrança na API e ativa o Pro de forma idempotente.
 * Sem ABACATEPAY_API_KEY o checkout responde 503 e a interface mostra lista de espera.
 */
const { authenticateUser, hasSafeFetchMetadata, isSameOrigin, sendJson, timingSafeEqualText } = require("../security/_security");
const { supabaseRequest } = require("../storage/_kazer-data");

const API_BASE = "https://api.abacatepay.com/v1";
const CYCLES = {
  monthly: { label: "KAZER Pro · mensal", env: "KAZER_PRO_PRICE_MONTHLY_CENTS", fallback: 2990 },
  yearly: { label: "KAZER Pro · anual", env: "KAZER_PRO_PRICE_YEARLY_CENTS", fallback: 29900 },
};

function priceFor(cycle) {
  const config = CYCLES[cycle];
  const value = Number.parseInt(process.env[config.env] || "", 10);
  return Number.isInteger(value) && value >= 100 ? value : config.fallback;
}

function billingConfigured() {
  return Boolean(String(process.env.ABACATEPAY_API_KEY || "").trim());
}

function appOrigin(request) {
  const configured = String(process.env.PUBLIC_APP_ORIGINS || "").split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  return configured[0] || `https://${String(request?.headers?.host || "kazer.vercel.app").split(",")[0].trim()}`;
}

async function abacate(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.ABACATEPAY_API_KEY}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    const error = new Error(String(data?.error || "abacatepay_request_failed").slice(0, 200));
    error.status = response.status;
    throw error;
  }
  return data?.data;
}

function plans() {
  return {
    configured: billingConfigured(),
    currency: "BRL",
    cycles: Object.keys(CYCLES).map((cycle) => ({ cycle, label: CYCLES[cycle].label, amountCents: priceFor(cycle) })),
  };
}

async function checkoutHandler(request, response) {
  if (request.method === "GET") return sendJson(response, 200, plans());
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  if (!isSameOrigin(request) || !hasSafeFetchMetadata(request)) return sendJson(response, 403, { error: "Origem não autorizada." });
  const user = await authenticateUser(request);
  if (!user) return sendJson(response, 401, { error: "Sessão inválida ou expirada." });
  if (!billingConfigured()) return sendJson(response, 503, { error: "O pagamento do KAZER Pro abre em breve.", waitlist: true });

  const body = typeof request.body === "string" ? (() => { try { return JSON.parse(request.body); } catch { return {}; } })() : request.body || {};
  const cycle = CYCLES[body.cycle] ? body.cycle : "monthly";
  const amountCents = priceFor(cycle);

  try {
    const rows = await supabaseRequest("kazer_billing_checkouts", { method: "POST", body: { user_id: user.id, cycle, amount_cents: amountCents } });
    const checkout = Array.isArray(rows) ? rows[0] : rows;
    if (!checkout?.id) throw new Error("checkout_not_created");
    const origin = appOrigin(request);
    const billing = await abacate("/billing/create", {
      method: "POST",
      body: {
        frequency: "ONE_TIME",
        methods: ["PIX"],
        products: [{ externalId: checkout.id, name: CYCLES[cycle].label, description: "Limites 10× maiores, modo Computer com prioridade e conectores ilimitados.", quantity: 1, price: amountCents }],
        returnUrl: `${origin}/chat?pro=canceled`,
        completionUrl: `${origin}/chat?pro=success`,
      },
    });
    if (!billing?.id || !/^https:\/\//.test(String(billing.url || ""))) throw new Error("billing_invalid");
    await supabaseRequest("kazer_billing_checkouts", { method: "PATCH", query: { id: `eq.${checkout.id}` }, body: { provider_billing_id: billing.id, checkout_url: billing.url } });
    return sendJson(response, 201, { url: billing.url, checkoutId: checkout.id });
  } catch (error) {
    console.error("Checkout failed", error?.message || "unknown");
    return sendJson(response, 502, { error: "Não foi possível abrir o pagamento agora. Tente de novo em instantes." });
  }
}

async function webhookHandler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }
  const expected = String(process.env.ABACATEPAY_WEBHOOK_SECRET || "");
  const received = String(request.query?.webhookSecret || "");
  if (expected.length < 16 || !timingSafeEqualText(received, expected)) return sendJson(response, 401, { error: "unauthorized" });

  const body = typeof request.body === "string" ? (() => { try { return JSON.parse(request.body); } catch { return null; } })() : request.body;
  if (body?.event !== "billing.paid") return sendJson(response, 200, { ignored: true });
  const billingId = String(body?.data?.billing?.id || "");
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(billingId)) return sendJson(response, 400, { error: "billing inválido" });

  try {
    // Confirma na própria API: um webhook forjado não ativa o Pro.
    const billings = await abacate("/billing/list");
    const confirmed = (Array.isArray(billings) ? billings : []).find((item) => item?.id === billingId && item?.status === "PAID");
    if (!confirmed) return sendJson(response, 202, { pending: true });
    const rows = await supabaseRequest("kazer_billing_checkouts", { query: { select: "id", provider_billing_id: `eq.${billingId}`, limit: 1 } });
    const checkout = Array.isArray(rows) ? rows[0] : rows;
    if (!checkout?.id) return sendJson(response, 404, { error: "checkout desconhecido" });
    await supabaseRequest("rpc/kazer_activate_pro", { method: "POST", body: { p_checkout_id: checkout.id } });
    return sendJson(response, 200, { activated: true });
  } catch (error) {
    console.error("Billing webhook failed", error?.message || "unknown");
    return sendJson(response, 500, { error: "retry" });
  }
}

module.exports = { checkoutHandler, plans, priceFor, webhookHandler };
