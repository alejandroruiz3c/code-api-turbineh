import { createHmac, timingSafeEqual } from "node:crypto";
import { WHATSAPP_GRAPH_VERSION, type WhatsAppSettings } from "./config";

/**
 * WhatsApp Business Cloud API (component messaging.whatsapp.meta), no SDK: POST /{version}/{phone-number-id}/messages
 * on the Graph API with the business's access token. Notifications outside the 24-hour customer service window must be
 * message templates approved in WhatsApp Manager, so this module sends templates only: name, language code and the
 * body's {{n}} values in order. The webhook's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret)
 * is checked here too.
 */
export interface TemplateMessage {
  to: string;
  template: { name: string; language: string; bodyParams: string[] };
}

export type CloudApiOutcome =
  | { ok: true; id: string; waId: string | null }
  | {
      ok: false;
      httpStatus: number;
      /** Graph error code (132001 template missing, 131026 undeliverable, 130429 throughput…). */
      code: string | null;
      message: string;
      retryable: boolean;
      /** The request may have reached Meta (no answer): never re-sent automatically. */
      unknown: boolean;
      retryAfterMs: number | null;
      /** The access token was refused (expired, revoked): 190 / 401. */
      unauthorized: boolean;
    };

/** Throughput and transient errors documented by Meta: a later attempt may pass. */
export const RETRYABLE_CODES = new Set([
  "1",
  "2",
  "4",
  "80007",
  "130429",
  "131000",
  "131016",
  "131056",
  "133004",
]);
/** The person stopped receiving this kind of message from the business. */
export const OPTED_OUT_CODES = new Set(["131050"]);

const TIMEOUT_MS = 15_000;
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

export const redact = (text: string) =>
  text.replace(/\bBearer\s+\S+/g, "Bearer [redacted]").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");

/** The request body Meta documents for a template message. */
export function templateBody(msg: TemplateMessage) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: msg.to,
    type: "template",
    template: {
      name: msg.template.name,
      language: { code: msg.template.language },
      ...(msg.template.bodyParams.length
        ? {
            components: [
              {
                type: "body",
                parameters: msg.template.bodyParams.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };
}

export async function sendTemplate(
  msg: TemplateMessage,
  s: WhatsAppSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudApiOutcome> {
  const failed = (o: Partial<Extract<CloudApiOutcome, { ok: false }>>): CloudApiOutcome => ({
    ok: false,
    httpStatus: 0,
    code: null,
    message: "error",
    retryable: false,
    unknown: false,
    retryAfterMs: null,
    unauthorized: false,
    ...o,
  });
  if (s.mode !== "cloud-api" || !s.accessToken || !s.phoneNumberId)
    return failed({ message: "WhatsApp Cloud API is not configured" });
  const url = `${s.apiBase}/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(s.phoneNumberId)}/messages`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(templateBody(msg)),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code ?? "";
    const notSent = NOT_SENT.has(code);
    return failed({
      code: code || null,
      message: notSent ? "WhatsApp Cloud API unreachable" : "No answer from the WhatsApp Cloud API",
      retryable: notSent,
      unknown: !notSent,
    });
  }
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const messages = Array.isArray(body.messages) ? (body.messages as { id?: unknown }[]) : [];
  if (res.ok && typeof messages[0]?.id === "string") {
    const contacts = Array.isArray(body.contacts) ? (body.contacts as { wa_id?: unknown }[]) : [];
    return {
      ok: true,
      id: messages[0].id,
      waId: typeof contacts[0]?.wa_id === "string" ? contacts[0].wa_id : null,
    };
  }
  const error = (body.error ?? {}) as Record<string, unknown>;
  const code = error.code != null ? String(error.code) : null;
  const after = res.headers.get("retry-after");
  return failed({
    httpStatus: res.status,
    code,
    message: redact(String(error.message ?? "error")).slice(0, 200),
    retryable: res.status === 429 || res.status >= 500 || RETRYABLE_CODES.has(code ?? ""),
    retryAfterMs: after && /^\d+$/.test(after) ? Number(after) * 1000 : null,
    unauthorized: res.status === 401 || code === "190",
  });
}

/** X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256 of the raw request body with the app secret (constant time). */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`,
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
