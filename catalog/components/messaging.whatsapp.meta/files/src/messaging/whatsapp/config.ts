import { z } from "zod";
import params from "./params.json";

/**
 * WhatsApp settings (component messaging.whatsapp.meta). The request's choices live in params.json (validated at
 * start-up); credentials only in the environment. Without WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID nothing is
 * sent: messages are logged (mode "log"). The Graph API version is pinned here and moves only with this component.
 */
export const WHATSAPP_GRAPH_VERSION = "v26.0";

export const WhatsAppParams = z.object({
  /** ISO 3166-1 alpha-2 country for numbers typed without a country code (e.g. "ES"), or null: "+" required. */
  defaultCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** Attempts per message for answers that may pass later (429, 5xx, throughput limits, provider unreachable). */
  maxAttempts: z.number().int().min(1).max(5),
});
export type WhatsAppParams = z.infer<typeof WhatsAppParams>;
export const whatsappParams: WhatsAppParams = WhatsAppParams.parse(params);

export interface WhatsAppSettings {
  mode: "cloud-api" | "log";
  accessToken: string | null;
  phoneNumberId: string | null;
  /** App secret: checks X-Hub-Signature-256 on webhook calls. */
  appSecret: string | null;
  /** Token you choose in the App Dashboard: answers Meta's webhook verification request. */
  verifyToken: string | null;
  /** Graph API base (tests point it at the local mock). */
  apiBase: string;
}

export function whatsappSettings(
  env: Record<string, string | undefined> = process.env,
): WhatsAppSettings {
  const v = (k: string) => (env[k] ?? "").trim() || null;
  const accessToken = v("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = v("WHATSAPP_PHONE_NUMBER_ID");
  return {
    mode: accessToken && phoneNumberId ? "cloud-api" : "log",
    accessToken,
    phoneNumberId,
    appSecret: v("WHATSAPP_APP_SECRET"),
    verifyToken: v("WHATSAPP_VERIFY_TOKEN"),
    apiBase: (v("WHATSAPP_API_BASE") ?? "https://graph.facebook.com").replace(/\/+$/, ""),
  };
}
