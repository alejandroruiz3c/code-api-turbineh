import type { BookingConfig } from "./config";
import { addDays, isDay, isoWeekday, localDay, minutesOf, timeOf, zonedToUtc } from "./time";

/**
 * Availability from real data only (component domain.bookings.turbineh): opening hours of the day, the service's
 * duration, the business time zone and the confirmed bookings of each resource. Pure functions, unit-tested
 * (including DST days). Nothing here is ever produced by a model.
 */
export interface Busy {
  resourceId: string;
  start: Date;
  end: Date;
}

export interface Slot {
  resourceId: string;
  start: Date;
  end: Date;
  /** Local "HH:MM". */
  time: string;
}

/** Why a requested day or time cannot be booked (shown to people as-is). */
export class PolicyError extends Error {}

/** Candidate starts of a day: every `slotMinutes` from each opening time, ending by closing time. */
export function dayStarts(
  day: string,
  minutes: number,
  cfg: BookingConfig,
): { time: string; start: Date; end: Date }[] {
  const weekday = isoWeekday(day);
  const out: { time: string; start: Date; end: Date }[] = [];
  for (const w of cfg.hours.filter((h) => h.weekday === weekday)) {
    const close = minutesOf(w.close);
    for (let m = minutesOf(w.open); m + minutes <= close; m += cfg.slotMinutes) {
      const time = timeOf(m);
      const start = zonedToUtc(day, time, cfg.timeZone);
      const endLocal = zonedToUtc(day, timeOf(m + minutes), cfg.timeZone);
      // Local times inside a DST gap do not exist: never offer them.
      if (!start || !endLocal) continue;
      out.push({ time, start, end: new Date(start.getTime() + minutes * 60_000) });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Grid cells a booking occupies (one row each in booking_slot_locks: the database refuses overlaps). */
export function cellsOf(start: Date, minutes: number, slotMinutes: number): Date[] {
  const n = Math.max(1, Math.ceil(minutes / slotMinutes));
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * slotMinutes * 60_000));
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) =>
  a.start < b.end && b.start < a.end;

/** Checks the day against the policy: valid date, open that day, not in the past, inside the horizon. */
export function assertBookableDay(day: string, cfg: BookingConfig, now: Date): void {
  if (!isDay(day)) throw new PolicyError("Dates must look like YYYY-MM-DD.");
  const today = localDay(now, cfg.timeZone);
  if (day < today) throw new PolicyError("That date is in the past.");
  if (day > addDays(today, cfg.policy.horizonDays))
    throw new PolicyError(`Bookings open up to ${cfg.policy.horizonDays} days ahead.`);
  if (!cfg.hours.some((h) => h.weekday === isoWeekday(day)))
    throw new PolicyError("We are closed that day.");
}

/** Free slots of a day for the given resources, from opening hours minus confirmed bookings and the notice rule. */
export function freeSlots(input: {
  day: string;
  minutes: number;
  resourceIds: string[];
  busy: Busy[];
  cfg: BookingConfig;
  now: Date;
}): Slot[] {
  const earliest = input.now.getTime() + input.cfg.policy.bookingNoticeMinutes * 60_000;
  const slots: Slot[] = [];
  for (const s of dayStarts(input.day, input.minutes, input.cfg)) {
    if (s.start.getTime() <= earliest || s.start.getTime() <= input.now.getTime()) continue;
    for (const resourceId of input.resourceIds) {
      const taken = input.busy.some((b) => b.resourceId === resourceId && overlaps(b, s));
      if (!taken) slots.push({ resourceId, start: s.start, end: s.end, time: s.time });
    }
  }
  return slots;
}

/** Moving or cancelling is allowed only `cancelNoticeHours` before the start. */
export function canChange(start: Date, cfg: BookingConfig, now: Date): boolean {
  return start.getTime() - now.getTime() >= cfg.policy.cancelNoticeHours * 3_600_000;
}
