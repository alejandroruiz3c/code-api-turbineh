import { eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { smsConsent, smsMessages } from "@/db/schema";
import { smsParams, smsSettings, type SmsSettings } from "./config";
import { replyKind, type ReplyKind } from "./keywords";
import { toE164 } from "./phone";
import { INVALID_NUMBER_CODES, sendViaTwilio, UNSUBSCRIBED_CODES } from "./twilio";

/**
 * Sending SMS with consent (component messaging.sms.twilio). Every message goes through `sendSms`:
 *  1. the number must be a valid E.164 number (libphonenumber-js);
 *  2. the number must have agreed ("opted_in") and not replied STOP since — otherwise nothing is sent;
 *  3. without Twilio credentials the message is logged, not sent (mode "log");
 *  4. otherwise one request to Twilio's Messages API, retried in this call for 429/5xx/unreachable answers with
 *     exponential backoff and jitter (Twilio's Retry-After honoured); an answer that never arrived is "unknown" and is
 *     never re-sent (Twilio's Messages API has no idempotency key).
 * Every outcome is recorded in sms_messages (never the text). Replies STOP/START and delivery updates arrive through the
 * signed webhook (src/app/api/messaging/sms/webhook/route.ts → handleTwilioWebhook).
 */
export type Consent = "opted_in" | "opted_out";

export interface SmsStore {
  consentOf(phone: string): Promise<Consent | null>;
  /** A STOP reply is only undone by a START reply: other sources never opt a number back in. */
  setConsent(phone: string, status: Consent, source: string): Promise<boolean>;
  record(row: {
    to: string;
    purpose: string;
    reference: string | null;
    status: string;
    reason: string | null;
    providerSid: string | null;
    errorCode: string | null;
    attempts: number;
  }): Promise<void>;
  /** Delivery update from Twilio for a message it accepted; false when the sid is unknown. */
  updateDelivery(sid: string, status: string, errorCode: string | null): Promise<boolean>;
}

const isKeyword = (source: string) => source.startsWith("keyword:");

export const dbSmsStore: SmsStore = {
  async consentOf(phone) {
    const [row] = await db
      .select({ status: smsConsent.status })
      .from(smsConsent)
      .where(eq(smsConsent.phone, phone))
      .limit(1);
    return (row?.status as Consent | undefined) ?? null;
  },
  async setConsent(phone, status, source) {
    const values = { phone, status, source: source.slice(0, 120), updatedAt: new Date() };
    // Opting in from a form never overrides an earlier STOP; a START reply does.
    const rows = await db
      .insert(smsConsent)
      .values(values)
      .onConflictDoUpdate({
        target: smsConsent.phone,
        set: { status, source: values.source, updatedAt: values.updatedAt },
        ...(status === "opted_in" && !isKeyword(source)
          ? { setWhere: ne(smsConsent.status, "opted_out") }
          : {}),
      })
      .returning({ phone: smsConsent.phone });
    return rows.length > 0;
  },
  async record(row) {
    await db.insert(smsMessages).values({ ...row, reason: row.reason?.slice(0, 200) ?? null });
  },
  async updateDelivery(sid, status, errorCode) {
    const rows = await db
      .update(smsMessages)
      .set({ status: status.slice(0, 16), errorCode, updatedAt: new Date() })
      .where(eq(smsMessages.providerSid, sid))
      .returning({ id: smsMessages.id });
    return rows.length > 0;
  },
};

export interface SmsDeps {
  store?: SmsStore;
  settings?: SmsSettings;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  defaultCountry?: string | null;
  maxAttempts?: number;
}

export type SmsResult =
  | { status: "sent"; sid: string; attempts: number }
  | { status: "logged" }
  | { status: "skipped"; reason: "invalid-number" | "no-consent" | "opted-out" }
  | {
      status: "failed";
      code: string | null;
      retryable: boolean;
      retryAfterMs: number | null;
      attempts: number;
    }
  | { status: "unknown"; attempts: number };

/** Longest wait inside one call; a longer Retry-After ends the call as a retryable failure for the caller. */
const MAX_WAIT_MS = 4_000;
const BASE_WAIT_MS = 500;

/** Exponential backoff with full jitter between half the ceiling and the ceiling (attempt is 1-based). */
export function waitBefore(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

/** Records that a person agreed to receive SMS on this number (e.g. a checked box on a form). */
export async function recordSmsConsent(
  phone: string,
  source: string,
  deps: Pick<SmsDeps, "store" | "defaultCountry"> = {},
): Promise<string | null> {
  const e164 = toE164(phone, deps.defaultCountry ?? smsParams.defaultCountry);
  if (!e164) return null;
  await (deps.store ?? dbSmsStore).setConsent(e164, "opted_in", source);
  return e164;
}

/** Sends one SMS when the number is valid and has agreed; never throws for provider or network errors. */
export async function sendSms(
  msg: { to: string; body: string; purpose: string; reference?: string | null },
  deps: SmsDeps = {},
): Promise<SmsResult> {
  if (msg.body.length === 0 || msg.body.length > 1600)
    throw new Error("SMS body must be 1–1600 characters (Twilio's limit)");
  const store = deps.store ?? dbSmsStore;
  const settings = deps.settings ?? smsSettings();
  const base = {
    purpose: msg.purpose.slice(0, 40),
    reference: msg.reference?.slice(0, 64) ?? null,
    providerSid: null,
    errorCode: null,
  };
  const e164 = toE164(msg.to, deps.defaultCountry ?? smsParams.defaultCountry);
  if (!e164) {
    await store.record({
      ...base,
      to: msg.to.replace(/[^+\d]/g, "").slice(0, 16),
      status: "skipped",
      reason: "invalid number",
      attempts: 0,
    });
    return { status: "skipped", reason: "invalid-number" };
  }
  const consent = await store.consentOf(e164);
  if (consent !== "opted_in") {
    const reason = consent === "opted_out" ? "opted-out" : "no-consent";
    await store.record({ ...base, to: e164, status: "skipped", reason, attempts: 0 });
    return { status: "skipped", reason };
  }
  if (settings.mode === "log") {
    // No provider configured: nothing leaves the app. The log says so; the text is never written anywhere.
    console.info("[sms:not-sent]", JSON.stringify({ purpose: base.purpose }));
    await store.record({
      ...base,
      to: e164,
      status: "logged",
      reason: "no SMS provider configured",
      attempts: 0,
    });
    return { status: "logged" };
  }
  const maxAttempts = deps.maxAttempts ?? smsParams.maxAttempts;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const statusCallback = settings.appUrl ? `${settings.appUrl}/api/messaging/sms/webhook` : null;
  for (let attempt = 1; ; attempt++) {
    const r = await sendViaTwilio(
      { to: e164, body: msg.body, statusCallback },
      settings,
      deps.fetch,
    );
    if (r.ok) {
      await store.record({
        ...base,
        to: e164,
        status: "sent",
        reason: null,
        providerSid: r.sid,
        attempts: attempt,
      });
      return { status: "sent", sid: r.sid, attempts: attempt };
    }
    if (r.unknown) {
      await store.record({
        ...base,
        to: e164,
        status: "unknown",
        reason: `${r.message} — not re-sent (it may have been delivered)`,
        attempts: attempt,
      });
      return { status: "unknown", attempts: attempt };
    }
    if (r.code && UNSUBSCRIBED_CODES.has(r.code)) {
      // The carrier/Twilio says this number replied STOP: remember it so nothing is tried again.
      await store.setConsent(e164, "opted_out", `provider:${r.code}`);
      await store.record({
        ...base,
        to: e164,
        status: "skipped",
        reason: "opted-out",
        errorCode: r.code,
        attempts: attempt,
      });
      return { status: "skipped", reason: "opted-out" };
    }
    const wait = r.retryAfterMs ?? waitBefore(attempt, deps.random);
    const again =
      r.retryable &&
      attempt < maxAttempts &&
      wait <= MAX_WAIT_MS &&
      !(r.code && INVALID_NUMBER_CODES.has(r.code));
    if (!again) {
      await store.record({
        ...base,
        to: e164,
        status: "failed",
        reason: `${r.httpStatus || "network"} ${r.message}`,
        errorCode: r.code,
        attempts: attempt,
      });
      return {
        status: "failed",
        code: r.code,
        retryable: r.retryable,
        retryAfterMs: r.retryAfterMs,
        attempts: attempt,
      };
    }
    await sleep(wait);
  }
}

/**
 * A signed webhook from Twilio (the route checks the signature first): a reply to our number (STOP / START / HELP) or a
 * delivery update of a message it accepted.
 */
export async function handleTwilioWebhook(
  params: Record<string, string>,
  deps: Pick<SmsDeps, "store"> = {},
): Promise<{ kind: "status"; known: boolean } | { kind: ReplyKind; phone: string | null }> {
  const store = deps.store ?? dbSmsStore;
  if (params.MessageStatus && params.MessageSid && params.Body === undefined) {
    const known = await store.updateDelivery(
      params.MessageSid,
      params.MessageStatus,
      params.ErrorCode || null,
    );
    return { kind: "status", known };
  }
  const phone = toE164(params.From ?? "");
  const kind = replyKind(params.Body, params.OptOutType);
  if (phone && kind === "opt-out") await store.setConsent(phone, "opted_out", "keyword:STOP");
  if (phone && kind === "opt-in") await store.setConsent(phone, "opted_in", "keyword:START");
  return { kind, phone };
}
