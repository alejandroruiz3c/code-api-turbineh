import { eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { whatsappConsent, whatsappMessages } from "@/db/schema";
import { whatsappParams, whatsappSettings, type WhatsAppSettings } from "./config";
import { OPTED_OUT_CODES, sendTemplate } from "./cloud-api";
import { waIdToE164, whatsappE164 } from "./phone";

/**
 * Sending WhatsApp template messages with consent (component messaging.whatsapp.meta). Every message goes through
 * `sendWhatsAppTemplate`:
 *  1. the number must be a valid E.164 number (libphonenumber-js);
 *  2. the person must have opted in and not written STOP since — otherwise nothing is sent;
 *  3. without WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID it is logged, not sent (mode "log");
 *  4. otherwise one Cloud API request per attempt, retried in this call for 429/5xx/throughput errors with exponential
 *     backoff and jitter; an answer that never arrived is "unknown" and never re-sent.
 * Every outcome is recorded in whatsapp_messages (never the text). Status updates (sent, delivered, read, failed) and
 * STOP/START messages arrive through the signed webhook (handleWhatsAppWebhook).
 */
export type Consent = "opted_in" | "opted_out";

export interface WhatsAppStore {
  consentOf(phone: string): Promise<Consent | null>;
  /** A STOP message is only undone by a START message: other sources never opt a number back in. */
  setConsent(phone: string, status: Consent, source: string): Promise<boolean>;
  record(row: {
    to: string;
    template: string;
    purpose: string;
    reference: string | null;
    status: string;
    reason: string | null;
    providerId: string | null;
    errorCode: string | null;
    attempts: number;
  }): Promise<void>;
  updateDelivery(id: string, status: string, errorCode: string | null): Promise<boolean>;
}

const isKeyword = (source: string) => source.startsWith("keyword:");

export const dbWhatsAppStore: WhatsAppStore = {
  async consentOf(phone) {
    const [row] = await db
      .select({ status: whatsappConsent.status })
      .from(whatsappConsent)
      .where(eq(whatsappConsent.phone, phone))
      .limit(1);
    return (row?.status as Consent | undefined) ?? null;
  },
  async setConsent(phone, status, source) {
    const values = { phone, status, source: source.slice(0, 120), updatedAt: new Date() };
    const rows = await db
      .insert(whatsappConsent)
      .values(values)
      .onConflictDoUpdate({
        target: whatsappConsent.phone,
        set: { status, source: values.source, updatedAt: values.updatedAt },
        ...(status === "opted_in" && !isKeyword(source)
          ? { setWhere: ne(whatsappConsent.status, "opted_out") }
          : {}),
      })
      .returning({ phone: whatsappConsent.phone });
    return rows.length > 0;
  },
  async record(row) {
    await db.insert(whatsappMessages).values({ ...row, reason: row.reason?.slice(0, 200) ?? null });
  },
  async updateDelivery(id, status, errorCode) {
    const rows = await db
      .update(whatsappMessages)
      .set({ status: status.slice(0, 16), errorCode, updatedAt: new Date() })
      .where(eq(whatsappMessages.providerId, id))
      .returning({ id: whatsappMessages.id });
    return rows.length > 0;
  },
};

export interface WhatsAppDeps {
  store?: WhatsAppStore;
  settings?: WhatsAppSettings;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  defaultCountry?: string | null;
  maxAttempts?: number;
}

export type WhatsAppResult =
  | { status: "accepted"; id: string; attempts: number }
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

const MAX_WAIT_MS = 4_000;
const BASE_WAIT_MS = 500;

/** Exponential backoff with full jitter between half the ceiling and the ceiling (attempt is 1-based). */
export function waitBefore(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

/** Records that a person opted in to WhatsApp messages on this number (e.g. a checked box on a form). */
export async function recordWhatsAppConsent(
  phone: string,
  source: string,
  deps: Pick<WhatsAppDeps, "store" | "defaultCountry"> = {},
): Promise<string | null> {
  const e164 = whatsappE164(phone, deps.defaultCountry ?? whatsappParams.defaultCountry);
  if (!e164) return null;
  await (deps.store ?? dbWhatsAppStore).setConsent(e164, "opted_in", source);
  return e164;
}

/** Sends one approved template to a number that opted in; never throws for provider or network errors. */
export async function sendWhatsAppTemplate(
  msg: {
    to: string;
    template: { name: string; language: string; bodyParams: string[] };
    purpose: string;
    reference?: string | null;
  },
  deps: WhatsAppDeps = {},
): Promise<WhatsAppResult> {
  const store = deps.store ?? dbWhatsAppStore;
  const settings = deps.settings ?? whatsappSettings();
  const base = {
    template: `${msg.template.name}/${msg.template.language}`.slice(0, 512),
    purpose: msg.purpose.slice(0, 40),
    reference: msg.reference?.slice(0, 64) ?? null,
    providerId: null,
    errorCode: null,
  };
  const e164 = whatsappE164(msg.to, deps.defaultCountry ?? whatsappParams.defaultCountry);
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
    console.info("[whatsapp:not-sent]", JSON.stringify({ purpose: base.purpose }));
    await store.record({
      ...base,
      to: e164,
      status: "logged",
      reason: "no WhatsApp provider configured",
      attempts: 0,
    });
    return { status: "logged" };
  }
  const maxAttempts = deps.maxAttempts ?? whatsappParams.maxAttempts;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    const r = await sendTemplate({ to: e164, template: msg.template }, settings, deps.fetch);
    if (r.ok) {
      await store.record({
        ...base,
        to: e164,
        status: "accepted",
        reason: null,
        providerId: r.id,
        attempts: attempt,
      });
      return { status: "accepted", id: r.id, attempts: attempt };
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
    if (r.code && OPTED_OUT_CODES.has(r.code)) {
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
    if (!r.retryable || attempt >= maxAttempts || wait > MAX_WAIT_MS) {
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

const OPT_OUT = /^(stop|unsubscribe|cancel|end|quit|optout|stopall)$/i;
const OPT_IN = /^(start|unstop|yes)$/i;

/** The webhook payload Meta posts (object "whatsapp_business_account"), after the route checked its signature. */
export async function handleWhatsAppWebhook(
  payload: unknown,
  deps: Pick<WhatsAppDeps, "store"> = {},
): Promise<{ statuses: number; optedOut: string[]; optedIn: string[] }> {
  const store = deps.store ?? dbWhatsAppStore;
  const out = { statuses: 0, optedOut: [] as string[], optedIn: [] as string[] };
  const p = payload as {
    object?: string;
    entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[];
  };
  if (p?.object !== "whatsapp_business_account") return out;
  for (const change of (p.entry ?? []).flatMap((e) => e.changes ?? [])) {
    if (change.field !== "messages" || !change.value) continue;
    const statuses = Array.isArray(change.value.statuses)
      ? (change.value.statuses as { id?: string; status?: string; errors?: { code?: number }[] }[])
      : [];
    for (const s of statuses) {
      if (!s.id || !s.status) continue;
      const code = s.errors?.[0]?.code;
      if (await store.updateDelivery(s.id, s.status, code != null ? String(code) : null))
        out.statuses++;
    }
    const messages = Array.isArray(change.value.messages)
      ? (change.value.messages as { from?: string; type?: string; text?: { body?: string } }[])
      : [];
    for (const m of messages) {
      const phone = waIdToE164(m.from ?? "");
      const text = (m.type === "text" ? (m.text?.body ?? "") : "")
        .trim()
        .replace(/^[\s.!¡?¿,;:"'()]+|[\s.!¡?¿,;:"'()]+$/g, "");
      if (!phone) continue;
      if (OPT_OUT.test(text)) {
        await store.setConsent(phone, "opted_out", "keyword:STOP");
        out.optedOut.push(phone);
      } else if (OPT_IN.test(text)) {
        await store.setConsent(phone, "opted_in", "keyword:START");
        out.optedIn.push(phone);
      }
    }
  }
  return out;
}
