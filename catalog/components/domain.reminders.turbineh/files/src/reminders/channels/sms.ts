import type { ReminderChannel } from "./types";

/** SMS reminders need messaging.sms.twilio: without it this channel does not exist (replaced by files-with/). */
export const smsChannel: ReminderChannel | null = null;
