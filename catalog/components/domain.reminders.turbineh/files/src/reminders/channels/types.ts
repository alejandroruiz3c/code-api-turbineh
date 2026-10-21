/**
 * A reminder channel besides email (component domain.reminders.turbineh): SMS (messaging.sms.twilio) or WhatsApp
 * (messaging.whatsapp.meta). Each one is a file under src/reminders/channels/ that is `null` until its messaging
 * component is in the app (files-with/<component>/ replaces it).
 */
export interface ChannelMessage {
  reference: string;
  phone: string;
  /** SMS text. */
  text: string;
  /** WhatsApp template body parameters. */
  templateParams: string[];
}

export type ChannelOutcome =
  | { status: "sent" | "logged"; reason: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; retryable: boolean; retryAfterMs: number | null }
  | { status: "unknown"; reason: string };

export interface ReminderChannel {
  id: "sms" | "whatsapp";
  /** The phone number as E.164, or null when it cannot receive messages. */
  normalize(phone: string): string | null;
  /** Records the person's consent on this number; returns the E.164 number, or null when invalid. */
  recordConsent(phone: string, source: string): Promise<string | null>;
  send(message: ChannelMessage): Promise<ChannelOutcome>;
}
