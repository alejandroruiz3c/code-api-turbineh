import { z } from "zod";
import params from "./params.json";

/**
 * SMS settings (component messaging.sms.twilio). The request's choices live in params.json (validated at start-up);
 * the credentials only in the environment. Without TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender
 * (TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID) nothing is sent: messages are logged (mode "log").
 */
export const SmsParams = z.object({
  /** ISO 3166-1 alpha-2 country for numbers typed without a country code (e.g. "ES"), or null: "+" required. */
  defaultCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** Attempts per message for answers that may pass later (429, 5xx, provider unreachable). */
  maxAttempts: z.number().int().min(1).max(5),
});
export type SmsParams = z.infer<typeof SmsParams>;
export const smsParams: SmsParams = SmsParams.parse(params);

export interface SmsSettings {
  mode: "twilio" | "log";
  accountSid: string | null;
  authToken: string | null;
  from: string | null;
  messagingServiceSid: string | null;
  /** Twilio's REST base (tests point it at the local mock). */
  apiBase: string;
  /** Public origin of this app, for the signed webhook (status callbacks and replies). */
  appUrl: string | null;
}

/** Settings from an environment (process.env by default). */
export function smsSettings(env: Record<string, string | undefined> = process.env): SmsSettings {
  const v = (k: string) => (env[k] ?? "").trim() || null;
  const accountSid = v("TWILIO_ACCOUNT_SID");
  const authToken = v("TWILIO_AUTH_TOKEN");
  const from = v("TWILIO_FROM_NUMBER");
  const messagingServiceSid = v("TWILIO_MESSAGING_SERVICE_SID");
  return {
    mode: accountSid && authToken && (from || messagingServiceSid) ? "twilio" : "log",
    accountSid,
    authToken,
    from,
    messagingServiceSid,
    apiBase: (v("TWILIO_API_BASE") ?? "https://api.twilio.com").replace(/\/+$/, ""),
    appUrl: (v("APP_URL") ?? v("BETTER_AUTH_URL"))?.replace(/\/+$/, "") ?? null,
  };
}
