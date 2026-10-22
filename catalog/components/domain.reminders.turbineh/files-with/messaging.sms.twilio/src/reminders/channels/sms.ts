import { smsParams } from "@/messaging/sms/config";
import { toE164 } from "@/messaging/sms/phone";
import { recordSmsConsent, sendSms } from "@/messaging/sms/service";
import type { ReminderChannel } from "./types";

/**
 * SMS reminders (domain.reminders.turbineh with messaging.sms.twilio): Twilio's Messages API through sendSms, which
 * sends only to numbers that agreed and have not replied STOP, and logs instead of sending without credentials.
 */
export const smsChannel: ReminderChannel | null = {
  id: "sms",
  normalize: (phone) => toE164(phone, smsParams.defaultCountry),
  recordConsent: (phone, source) => recordSmsConsent(phone, source),
  async send(m) {
    const r = await sendSms({
      to: m.phone,
      body: m.text,
      purpose: "reminder",
      reference: m.reference,
    });
    switch (r.status) {
      case "sent":
        return { status: "sent", reason: null };
      case "logged":
        return { status: "logged", reason: "no SMS provider configured" };
      case "skipped":
        return { status: "skipped", reason: r.reason };
      case "unknown":
        return { status: "unknown", reason: "no answer from Twilio; not re-sent" };
      case "failed":
        return {
          status: "failed",
          reason: `Twilio ${r.code ?? "error"}`,
          retryable: r.retryable,
          retryAfterMs: r.retryAfterMs,
        };
    }
  },
};
