import type { ReminderChannel } from "./types";

/** WhatsApp reminders need messaging.whatsapp.meta: without it this channel does not exist (replaced by files-with/). */
export const whatsappChannel: ReminderChannel | null = null;
