/** Pure booking rules (recipe bookings). Times are UTC; unit-tested in tests/unit/bookings.test.ts. */

export interface Interval {
  start: Date;
  end: Date;
}

export interface Window {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export const LIMITS = { minMinutes: 15, maxMinutes: 8 * 60, maxDaysAhead: 365 } as const;

/** Half-open intervals: a booking ending at 10:00 does not overlap one starting at 10:00. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

const minuteOfDay = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

/** The whole booking must fit inside one availability window of its (UTC) weekday, on a single day. */
export function withinAvailability(slot: Interval, windows: Window[]): boolean {
  if (
    slot.start.toISOString().slice(0, 10) !==
    new Date(slot.end.getTime() - 1).toISOString().slice(0, 10)
  ) {
    return false;
  }
  const day = slot.start.getUTCDay();
  const from = minuteOfDay(slot.start);
  const to = from + Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
  return windows.some((w) => w.weekday === day && w.startMinute <= from && to <= w.endMinute);
}

/** Validates duration and horizon; returns a user-facing problem or null. */
export function slotProblem(slot: Interval, now = new Date()): string | null {
  const minutes = (slot.end.getTime() - slot.start.getTime()) / 60_000;
  if (!(minutes >= LIMITS.minMinutes))
    return `Bookings last at least ${LIMITS.minMinutes} minutes.`;
  if (minutes > LIMITS.maxMinutes) return "Bookings last at most 8 hours.";
  if (slot.start < now) return "Choose a time in the future.";
  if (slot.start.getTime() - now.getTime() > LIMITS.maxDaysAhead * 86_400_000) {
    return "Bookings can be made up to one year ahead.";
  }
  return null;
}

/** "HH:MM" → minutes from midnight, or null. */
export function parseClock(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
