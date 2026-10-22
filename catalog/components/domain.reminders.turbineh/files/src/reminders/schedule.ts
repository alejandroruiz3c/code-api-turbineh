import { describeLocal } from "@/bookings/time";

/**
 * When a reminder is due and what it says (component domain.reminders.turbineh). Pure functions, unit-tested:
 *  - a reminder is due `hoursBefore` real hours before the appointment starts (an instant, so daylight saving changes
 *    never move it); it is sent by the first runner call at or after that instant, while the appointment has not
 *    started;
 *  - an appointment booked after its reminder time (e.g. booked today for tomorrow with a 24-hour reminder) gets no
 *    reminder: the confirmation was just sent;
 *  - every text shows the appointment's local time in the business's time zone.
 */
export const HOUR_MS = 3_600_000;

export const dueAt = (startsAt: Date, hoursBefore: number): Date =>
  new Date(startsAt.getTime() - hoursBefore * HOUR_MS);

export function isDue(
  a: { startsAt: Date; createdAt: Date },
  hoursBefore: number,
  now: Date,
): boolean {
  const due = dueAt(a.startsAt, hoursBefore);
  return now >= due && now < a.startsAt && a.createdAt <= due;
}

/** Wait before the next attempt after `attempt` failed ones: 1 min, 2, 4… up to 1 h, with jitter (½–1×). */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | null = null,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(HOUR_MS, 60_000 * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(ceiling / 2 + (ceiling / 2) * random());
  return Math.max(jittered, retryAfterMs ?? 0);
}

export interface ReminderFacts {
  reference: string;
  customerName: string;
  service: string;
  resource: string;
  startsAt: Date;
  business: string;
  timeZone: string;
}

/** "Tuesday 2026-10-20 10:30 (Europe/Madrid)". */
export const whenText = (f: Pick<ReminderFacts, "startsAt" | "timeZone">): string =>
  `${describeLocal(f.startsAt, f.timeZone)} (${f.timeZone})`;

export function emailReminder(f: ReminderFacts, cancelNoticeHours: number) {
  return {
    subject: `${f.business}: reminder of your ${f.service} on ${describeLocal(f.startsAt, f.timeZone)}`,
    text: [
      `Hello ${f.customerName},`,
      `This is a reminder of your ${f.service} with ${f.resource} on ${whenText(f)}.`,
      `Booking reference: ${f.reference}.`,
      `If you cannot come, cancel with the link in your confirmation email (up to ${cancelNoticeHours} hours before).`,
    ].join("\n"),
  };
}

/** One SMS segment where possible; always says how to stop. */
export function smsReminder(f: ReminderFacts): string {
  return `${f.business}: reminder of your ${f.service} with ${f.resource} on ${whenText(f)}. Ref ${f.reference}. Reply STOP to opt out.`;
}

/** The approved template's four body parameters, in order. */
export const whatsappReminderParams = (f: ReminderFacts): string[] => [
  f.customerName,
  f.service,
  whenText(f),
  f.business,
];
