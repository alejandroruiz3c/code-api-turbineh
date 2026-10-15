import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingAppointments, bookingResources, bookingTimeOff } from "@/db/schema";
import { canChange, PolicyError } from "./availability";
import { bookingConfig as cfg } from "./config";
import {
  cancelAppointment,
  hashToken,
  listResources,
  moveAppointment,
  type SlotChoice,
} from "./service";
import { addDays, describeLocal, isTime, localDay, localTime, zonedToUtc } from "./time";

/**
 * Booking management beyond the core service (component domain.bookings.turbineh): the public cancel link with the
 * notice policy, staff moves, time off per team member and the staff calendar (day or week). Every rule is enforced
 * here or in service.ts; pages and actions only call these functions.
 */
const when = (d: Date) => `${describeLocal(d, cfg.timeZone)} (${cfg.timeZone})`;
const TOKEN = /^[\w-]{20,64}$/;

// ─── Public cancel link ─────────────────────────────────────────────────────────────────────────────────────────

/** The appointment a cancel link points to (any status), or null. Only the token's SHA-256 is stored. */
export async function appointmentByCancelToken(token: string, now = new Date()) {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .select({ a: bookingAppointments, resource: bookingResources.name })
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(eq(bookingAppointments.cancelTokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  return {
    reference: row.a.reference,
    status: row.a.status,
    when: when(row.a.startsAt),
    service: row.a.service,
    resource: row.resource,
    canCancel: row.a.status === "confirmed" && canChange(row.a.startsAt, cfg, now),
  };
}

/** Cancels through the emailed link, only up to `cancelNoticeHours` before the start (PolicyError otherwise). */
export async function cancelByToken(token: string, now = new Date()) {
  const [row] = TOKEN.test(token)
    ? await db
        .select({
          reference: bookingAppointments.reference,
          email: bookingAppointments.customerEmail,
        })
        .from(bookingAppointments)
        .where(
          and(
            eq(bookingAppointments.cancelTokenHash, hashToken(token)),
            eq(bookingAppointments.status, "confirmed"),
          ),
        )
        .limit(1)
    : [];
  if (!row) throw new PolicyError("This booking is already cancelled or the link is not valid.");
  return cancelAppointment(row.reference, row.email, { now });
}

// ─── Staff: move, time off, calendar ────────────────────────────────────────────────────────────────────────────

/** Staff move a booking to another free time (and team member); the customer is emailed. No notice rule for staff. */
export async function staffMove(id: string, to: SlotChoice, now = new Date()) {
  const [a] = await db
    .select({ reference: bookingAppointments.reference, email: bookingAppointments.customerEmail })
    .from(bookingAppointments)
    .where(and(eq(bookingAppointments.id, id), eq(bookingAppointments.status, "confirmed")))
    .limit(1);
  if (!a) throw new PolicyError("Booking not found.");
  return moveAppointment(a.reference, a.email, to, { now, byStaff: true });
}

/** Blocks a team member's time (local day and times). Refused while confirmed bookings fall inside it. */
export async function addTimeOff(input: {
  resourceId: string;
  day: string;
  from: string;
  to: string;
  reason?: string | null;
  by: string;
}) {
  if (!isTime(input.from) || !isTime(input.to) || input.from >= input.to)
    throw new PolicyError("Choose a start time before the end time.");
  const start = zonedToUtc(input.day, input.from, cfg.timeZone);
  const end = zonedToUtc(input.day, input.to, cfg.timeZone);
  if (!start || !end) throw new PolicyError("That local time does not exist (daylight saving).");
  const clash = await db
    .select({ reference: bookingAppointments.reference })
    .from(bookingAppointments)
    .where(
      and(
        eq(bookingAppointments.resourceId, input.resourceId),
        eq(bookingAppointments.status, "confirmed"),
        lt(bookingAppointments.startsAt, end),
        gt(bookingAppointments.endsAt, start),
      ),
    );
  if (clash.length)
    throw new PolicyError(
      `Bookings ${clash.map((c) => c.reference).join(", ")} fall inside that time: move or cancel them first.`,
    );
  await db.insert(bookingTimeOff).values({
    resourceId: input.resourceId,
    startsAt: start,
    endsAt: end,
    reason: input.reason?.trim().slice(0, 120) || null,
    createdBy: input.by,
  });
}

export async function removeTimeOff(id: string): Promise<void> {
  await db.delete(bookingTimeOff).where(eq(bookingTimeOff.id, id));
}

/** Time off from now on (staff page). */
export async function upcomingTimeOff(now = new Date()) {
  const rows = await db
    .select({ t: bookingTimeOff, resource: bookingResources.name })
    .from(bookingTimeOff)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingTimeOff.resourceId))
    .where(gt(bookingTimeOff.endsAt, now))
    .orderBy(asc(bookingTimeOff.startsAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.t.id,
    resource: r.resource,
    from: describeLocal(r.t.startsAt, cfg.timeZone),
    to: localTime(r.t.endsAt, cfg.timeZone),
    reason: r.t.reason,
  }));
}

export interface CalendarEntry {
  id: string;
  kind: "booking" | "time-off";
  resourceId: string;
  day: string;
  start: string;
  end: string;
  title: string;
  detail: string;
  reference: string | null;
}

/** Bookings and time off from `fromDay` for `days` local days, per team member (staff calendar, day or week). */
export async function calendar(fromDay: string, days: number, resourceId?: string) {
  const resources = (await listResources()).filter((r) => !resourceId || r.id === resourceId);
  const start = zonedToUtc(fromDay, "00:00", cfg.timeZone) ?? new Date(`${fromDay}T00:00:00Z`);
  const endDay = addDays(fromDay, days);
  const end = zonedToUtc(endDay, "00:00", cfg.timeZone) ?? new Date(`${endDay}T00:00:00Z`);
  const ids = resources.map((r) => r.id);
  if (ids.length === 0) return { resources, entries: [] as CalendarEntry[] };
  const [booked, off] = await Promise.all([
    db
      .select()
      .from(bookingAppointments)
      .where(
        and(
          eq(bookingAppointments.status, "confirmed"),
          inArray(bookingAppointments.resourceId, ids),
          lt(bookingAppointments.startsAt, end),
          gt(bookingAppointments.endsAt, start),
        ),
      )
      .orderBy(asc(bookingAppointments.startsAt)),
    db
      .select()
      .from(bookingTimeOff)
      .where(
        and(
          inArray(bookingTimeOff.resourceId, ids),
          lt(bookingTimeOff.startsAt, end),
          gt(bookingTimeOff.endsAt, start),
        ),
      )
      .orderBy(asc(bookingTimeOff.startsAt)),
  ]);
  const tz = cfg.timeZone;
  const entries: CalendarEntry[] = [
    ...booked.map((b) => ({
      id: b.id,
      kind: "booking" as const,
      resourceId: b.resourceId,
      day: localDay(b.startsAt, tz),
      start: localTime(b.startsAt, tz),
      end: localTime(b.endsAt, tz),
      title: `${b.service} · ${b.customerName}`,
      detail: [b.customerEmail, b.customerPhone].filter(Boolean).join(" · "),
      reference: b.reference,
    })),
    ...off.map((t) => ({
      id: t.id,
      kind: "time-off" as const,
      resourceId: t.resourceId,
      day: localDay(t.startsAt, tz),
      start: localTime(t.startsAt, tz),
      end: localTime(t.endsAt, tz),
      title: `Time off${t.reason ? ` · ${t.reason}` : ""}`,
      detail: "",
      reference: null,
    })),
  ].sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
  return { resources, entries };
}
