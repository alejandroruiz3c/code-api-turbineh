import { whatsappParams } from "@/messaging/whatsapp/config";
import { whatsappE164 } from "@/messaging/whatsapp/phone";
import { recordWhatsAppConsent, sendWhatsAppTemplate } from "@/messaging/whatsapp/service";
import { reminderConfig } from "../config";
import type { ReminderChannel } from "./types";

/**
 * WhatsApp reminders (domain.reminders.turbineh with messaging.whatsapp.meta): the approved template of
 * src/reminders/params.json (business-initiated messages outside the 24-hour window must be templates), sent only to
 * people who opted in and have not written STOP; logged instead of sent without credentials.
 */
export const whatsappChannel: ReminderChannel | null = {
  id: "whatsapp",
  normalize: (phone) => whatsappE164(phone, whatsappParams.defaultCountry),
  recordConsent: (phone, source) => recordWhatsAppConsent(phone, source),
  async send(m) {
    const r = await sendWhatsAppTemplate({
      to: m.phone,
      template: { ...reminderConfig.whatsappTemplate, bodyParams: m.templateParams },
      purpose: "reminder",
      reference: m.reference,
    });
    switch (r.status) {
      case "accepted":
        return { status: "sent", reason: null };
      case "logged":
        return { status: "logged", reason: "no WhatsApp provider configured" };
      case "skipped":
        return { status: "skipped", reason: r.reason };
      case "unknown":
        return { status: "unknown", reason: "no answer from WhatsApp; not re-sent" };
      case "failed":
        return {
          status: "failed",
          reason: `WhatsApp ${r.code ?? "error"}`,
          retryable: r.retryable,
          retryAfterMs: r.retryAfterMs,
        };
    }
  },
};
