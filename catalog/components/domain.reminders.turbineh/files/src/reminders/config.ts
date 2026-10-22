import { z } from "zod";
import params from "./params.json";

/**
 * Appointment reminders (component domain.reminders.turbineh): how long before each appointment, and on which channels.
 * Written by TurbineH from the request ("a WhatsApp reminder 24 hours before") and validated at start-up.
 */
export const CHANNELS = ["email", "sms", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export const ReminderParams = z.object({
  /** Real hours between the reminder and the start of the appointment (daylight saving included). */
  hoursBefore: z.number().int().min(1).max(168),
  channels: z
    .array(z.enum(CHANNELS))
    .min(1)
    .max(3)
    .refine((c) => new Set(c).size === c.length, "channels must be unique"),
  /**
   * The WhatsApp message template approved in WhatsApp Manager (utility category), with four body parameters in this
   * order: {{1}} customer name, {{2}} service, {{3}} date and time, {{4}} business.
   */
  whatsappTemplate: z.object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
  }),
  /** Attempts per reminder for failures that may pass later (each attempt is one runner call). */
  maxAttempts: z.number().int().min(1).max(10),
});
export type ReminderParams = z.infer<typeof ReminderParams>;

export const reminderConfig: ReminderParams = ReminderParams.parse(params);
