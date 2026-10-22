import { createHmac, timingSafeEqual } from "node:crypto";
import type { SmsSettings } from "./config";

/**
 * Twilio Programmable Messaging over its REST API (component messaging.sms.twilio), no SDK: one documented request,
 * POST /2010-04-01/Accounts/{AccountSid}/Messages.json (form-encoded To, From or MessagingServiceSid, Body,
 * StatusCallback) with HTTP Basic auth, and the X-Twilio-Signature check of the webhooks Twilio sends back.
 */
export interface TwilioMessage {
  to: string;
  body: string;
  /** Where Twilio posts delivery updates (signed); omitted when the app has no public URL. */
  statusCallback?: string | null;
}

export type TwilioOutcome =
  | { ok: true; sid: string; status: string }
  | {
      ok: false;
      /** HTTP status, or 0 when no answer arrived. */
      httpStatus: number;
      /** Twilio error code (21211 invalid number, 21610 unsubscribed recipient, 20429 too many requests…). */
      code: string | null;
      message: string;
      /** A later attempt may pass (429, 5xx, provider unreachable before the request was sent). */
      retryable: boolean;
      /** The request may have reached Twilio (timeout after sending): never re-sent automatically. */
      unknown: boolean;
      retryAfterMs: number | null;
    };

/** Twilio's documented error codes that mean "the recipient opted out" (STOP at the carrier / Advanced Opt-Out). */
export const UNSUBSCRIBED_CODES = new Set(["21610"]);
/** The number cannot receive SMS at all: no retry. */
export const INVALID_NUMBER_CODES = new Set(["21211", "21614", "21612", "21408"]);

const TIMEOUT_MS = 15_000;
/** Connection errors that prove the request never left: safe to try again. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function retryAfter(res: Response): number | null {
  const after = res.headers.get("retry-after");
  if (after && /^\d+$/.test(after)) return Number(after) * 1000;
  return null;
}

/** Removes anything token-shaped before a provider message is stored or shown. */
export const redact = (text: string) =>
  text
    .replace(/\b(Basic|Bearer)\s+\S+/g, "$1 [redacted]")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]");

/** One request to Twilio's Messages resource. Never throws for provider or network errors. */
export async function sendViaTwilio(
  msg: TwilioMessage,
  s: SmsSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioOutcome> {
  if (s.mode !== "twilio" || !s.accountSid || !s.authToken)
    return {
      ok: false,
      httpStatus: 0,
      code: null,
      message: "Twilio is not configured",
      retryable: false,
      unknown: false,
      retryAfterMs: null,
    };
  const form = new URLSearchParams({ To: msg.to, Body: msg.body });
  if (s.messagingServiceSid) form.set("MessagingServiceSid", s.messagingServiceSid);
  else if (s.from) form.set("From", s.from);
  if (msg.statusCallback) form.set("StatusCallback", msg.statusCallback);
  const url = `${s.apiBase}/2010-04-01/Accounts/${encodeURIComponent(s.accountSid)}/Messages.json`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code ?? "";
    const notSent = NOT_SENT.has(code);
    return {
      ok: false,
      httpStatus: 0,
      code: code || null,
      message: notSent ? "Twilio unreachable" : "No answer from Twilio",
      retryable: notSent,
      unknown: !notSent,
      retryAfterMs: null,
    };
  }
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (res.status >= 200 && res.status < 300 && typeof body.sid === "string")
    return { ok: true, sid: body.sid, status: String(body.status ?? "queued") };
  const code = body.code != null ? String(body.code) : null;
  return {
    ok: false,
    httpStatus: res.status,
    code,
    message: redact(String(body.message ?? "error")).slice(0, 200),
    retryable: res.status === 429 || res.status >= 500 || code === "20429",
    unknown: false,
    retryAfterMs: retryAfter(res),
  };
}

/**
 * X-Twilio-Signature: Base64(HMAC-SHA1(auth token, full URL + each POST parameter name and value, sorted by name)).
 * `url` must be the exact public URL Twilio called (scheme, host, path and query string).
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k] ?? ""}`)
      .join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** Constant-time comparison of the header Twilio sent with the expected signature. */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
