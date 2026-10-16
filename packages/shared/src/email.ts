import { createLogger } from "./logger.js";

/**
 * Outbound email for the platform itself (ADR-0056): Resend's HTTP API with plain fetch, no SDK. Only TurbineH's own
 * notices (priority list, owner demand alert) go through it; generated client apps never use this module.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend `Idempotency-Key`: a retried send with the same key is delivered once. */
  idempotencyKey?: string;
  /** Files attached to the email (UTF-8 text content, e.g. CSV), sent base64-encoded. */
  attachments?: { filename: string; content: string }[];
}

export type SendResult =
  { ok: true; id: string | null } | { ok: false; status: number; error: string };

export interface Mailer {
  /** Sender, e.g. `TurbineH <support@turbineh.com>`. */
  readonly from: string;
  /** Where the owner's demand alerts go (`DEMAND_ALERT_EMAIL`). */
  readonly ownerAlertTo: string;
  /** Public product URL used in links. */
  readonly appUrl: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export const DEFAULT_EMAIL_FROM = "TurbineH <support@turbineh.com>";
export const DEFAULT_DEMAND_ALERT_EMAIL = "alex.ruiz@turbineh.com";
export const DEFAULT_APP_URL = "https://software.turbineh.com";
const RESEND_URL = "https://api.resend.com/emails";

export function resendMailer(opts: {
  apiKey: string;
  from?: string;
  ownerAlertTo?: string;
  appUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Mailer {
  const doFetch = opts.fetch ?? fetch;
  const from = opts.from || DEFAULT_EMAIL_FROM;
  return {
    from,
    ownerAlertTo: opts.ownerAlertTo || DEFAULT_DEMAND_ALERT_EMAIL,
    appUrl: (opts.appUrl || DEFAULT_APP_URL).replace(/\/+$/, ""),
    async send(m) {
      try {
        const res = await doFetch(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            ...(m.attachments?.length
              ? {
                  attachments: m.attachments.map((a) => ({
                    filename: a.filename,
                    content: Buffer.from(a.content, "utf8").toString("base64"),
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
          message?: string;
          name?: string;
        };
        if (!res.ok) {
          // Resend's error name/message never contains the key; keep it short and free of recipient data.
          return {
            ok: false,
            status: res.status,
            error: (body.name ?? body.message ?? "error").slice(0, 120),
          };
        }
        return { ok: true, id: body.id ?? null };
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.name : "network_error" };
      }
    },
  };
}

let warned = false;

/**
 * The mailer configured by `RESEND_API_KEY` (and optional `EMAIL_FROM`, `DEMAND_ALERT_EMAIL`, `EMAIL_APP_URL`), or
 * `null` when there is no key: the caller skips sending, and a single warning is logged per process.
 */
export function mailerFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Mailer | null {
  const apiKey = source.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (!warned) {
      warned = true;
      createLogger("email").warn("RESEND_API_KEY not set: platform emails are skipped");
    }
    return null;
  }
  return resendMailer({
    apiKey,
    ...(source.EMAIL_FROM ? { from: source.EMAIL_FROM.trim() } : {}),
    ...(source.DEMAND_ALERT_EMAIL ? { ownerAlertTo: source.DEMAND_ALERT_EMAIL.trim() } : {}),
    ...(source.EMAIL_APP_URL || source.BETTER_AUTH_URL
      ? { appUrl: (source.EMAIL_APP_URL || source.BETTER_AUTH_URL || "").trim() }
      : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/** Test hook: allow the missing-key warning again. */
export function resetMailerWarning(): void {
  warned = false;
}

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A plausible single address (no display name, no list, no header characters). */
export function isEmailAddress(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/.test(value)
  );
}
