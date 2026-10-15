import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookingAppointments,
  bookingFaq,
  bookingNotifications,
  bookingResources,
  bookingSlotLocks,
  bookingTimeOff,
} from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import {
  assertBookableDay,
  canChange,
  cellsOf,
  freeSlots,
  PolicyError,
  type Slot,
} from "./availability";
import { bookingConfig as cfg, priceLabel, type BookingConfig } from "./config";
import { describeLocal, isTime, localDay, localTime } from "./time";

/**
 * Booking domain service (component domain.bookings.turbineh): the only code that reads or changes appointments.
 * Used by the assistant's tools (toolkit.ts) and by the staff pages. Every rule is enforced here, so neither a model
 * nor a form can book an invented slot, double-book a resource or skip the notice policy.
 */
export { PolicyError };

type Service = BookingConfig["services"][number];
type Resource = { id: string; name: string };

const normEmail = (e: string) => e.trim().toLowerCase();
const newReference = () =>
  randomBytes(6).toString("base64url").replace(/[-_]/g, "X").slice(0, 8).toUpperCase();
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && (e as { code?: unknown }).code === "23505") ||
    ("cause" in e && isUniqueViolation((e as { cause?: unknown }).cause)));

let seeded: Promise<void> | null = null;

/** First use: the team and the questions from the request (idempotent; staff edit them afterwards). */
export function ensureSeeded(): Promise<void> {
  seeded ??= (async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${742_031})`);
      const [r] = await tx.select({ id: bookingResources.id }).from(bookingResources).limit(1);
      if (!r) {
        const names = Array.from(
          { length: cfg.resource.count },
          (_, i) => cfg.resource.names[i] ?? `${cfg.resource.singular} ${i + 1}`,
        );
        await tx.insert(bookingResources).values(names.map((name, sort) => ({ name, sort })));
      }
      const [f] = await tx.select({ id: bookingFaq.id }).from(bookingFaq).limit(1);
      if (!f && cfg.faq.length > 0) {
        await tx
          .insert(bookingFaq)
          .values(cfg.faq.map((q, sort) => ({ topic: q.topic, answer: q.answer, sort })))
          .onConflictDoNothing();
      }
    });
  })().catch((err: unknown) => {
    seeded = null;
    throw err;
  });
  return seeded;
}

export async function listResources(includeInactive = false): Promise<Resource[]> {
  await ensureSeeded();
  return db
    .select({ id: bookingResources.id, name: bookingResources.name })
    .from(bookingResources)
    .where(includeInactive ? undefined : eq(bookingResources.active, true))
    .orderBy(asc(bookingResources.sort), asc(bookingResources.name));
}

/** "any"/empty → every active resource; otherwise the one whose name matches. */
async function resolveResources(name: string | undefined): Promise<Resource[]> {
  const all = await listResources();
  const wanted = name?.trim().toLowerCase();
  if (!wanted || /^(any|anyone|any one|whoever|no preference|cualquiera)$/.test(wanted)) return all;
  const exact = all.filter((r) => r.name.toLowerCase() === wanted);
  const match = exact.length ? exact : all.filter((r) => r.name.toLowerCase().includes(wanted));
  if (match.length === 0)
    throw new PolicyError(
      `Unknown ${cfg.resource.singular.toLowerCase()}. Choose one of: ${all.map((r) => r.name).join(", ")}, or "any".`,
    );
  return match;
}

/** Named service, or the default: a "first"/"initial" service for new people, a "follow-up" for returning ones. */
async function resolveService(name: string | undefined, email?: string): Promise<Service> {
  const wanted = name?.trim().toLowerCase();
  if (wanted) {
    const s =
      cfg.services.find((x) => x.name.toLowerCase() === wanted) ??
      cfg.services.find((x) => x.name.toLowerCase().includes(wanted));
    if (!s)
      throw new PolicyError(
        `Unknown service. Choose one of: ${cfg.services.map((x) => x.name).join(", ")}.`,
      );
    return s;
  }
  const first = cfg.services.find((s) => /\b(first|initial|new|intro)/i.test(s.name));
  const followUp = cfg.services.find((s) => /\b(follow|return|repeat|regular)/i.test(s.name));
  if (email && first && followUp) {
    const [prev] = await db
      .select({ id: bookingAppointments.id })
      .from(bookingAppointments)
      .where(
        and(
          eq(bookingAppointments.customerEmail, normEmail(email)),
          eq(bookingAppointments.status, "confirmed"),
        ),
      )
      .limit(1);
    return prev ? followUp : first;
  }
  return cfg.services[0] as Service;
}

/** Confirmed appointments and time off of these resources overlapping [from, to). */
async function busyOf(resourceIds: string[], from: Date, to: Date, ignoreId?: string) {
  if (resourceIds.length === 0) return [];
  const [booked, off] = await Promise.all([
    db
      .select({
        resourceId: bookingAppointments.resourceId,
        start: bookingAppointments.startsAt,
        end: bookingAppointments.endsAt,
      })
      .from(bookingAppointments)
      .where(
        and(
          eq(bookingAppointments.status, "confirmed"),
          inArray(bookingAppointments.resourceId, resourceIds),
          lt(bookingAppointments.startsAt, to),
          gt(bookingAppointments.endsAt, from),
          ignoreId ? ne(bookingAppointments.id, ignoreId) : undefined,
        ),
      ),
    db
      .select({
        resourceId: bookingTimeOff.resourceId,
        start: bookingTimeOff.startsAt,
        end: bookingTimeOff.endsAt,
      })
      .from(bookingTimeOff)
      .where(
        and(
          inArray(bookingTimeOff.resourceId, resourceIds),
          lt(bookingTimeOff.startsAt, to),
          gt(bookingTimeOff.endsAt, from),
        ),
      ),
  ]);
  return [...booked, ...off];
}

/** Free slots of a day (real data: hours, duration, time zone, confirmed bookings). */
export async function availability(input: {
  day: string;
  resource?: string;
  service?: string;
  now?: Date;
  ignoreAppointmentId?: string;
}): Promise<{
  day: string;
  timeZone: string;
  service: Service;
  slots: (Slot & { resource: string })[];
}> {
  const now = input.now ?? new Date();
  assertBookableDay(input.day, cfg, now);
  const service = await resolveService(input.service);
  const resources = await resolveResources(input.resource);
  // Wide window: the local day can span two UTC dates.
  const from = new Date(`${input.day}T00:00:00Z`);
  const busy = await busyOf(
    resources.map((r) => r.id),
    new Date(from.getTime() - 36 * 3_600_000),
    new Date(from.getTime() + 60 * 3_600_000),
    input.ignoreAppointmentId,
  );
  const names = new Map(resources.map((r) => [r.id, r.name]));
  const slots = freeSlots({
    day: input.day,
    minutes: service.minutes,
    resourceIds: resources.map((r) => r.id),
    busy,
    cfg,
    now,
  }).map((s) => ({ ...s, resource: names.get(s.resourceId) ?? "" }));
  return { day: input.day, timeZone: cfg.timeZone, service, slots };
}

export interface SlotChoice {
  day: string;
  time: string;
  resource?: string;
  service?: string;
}

/** A requested slot checked against real availability; returns the free resource. Throws PolicyError. */
export async function checkSlot(
  choice: SlotChoice & { email?: string },
  now = new Date(),
  ignoreAppointmentId?: string,
): Promise<{ start: Date; end: Date; resource: Resource; service: Service }> {
  if (!isTime(choice.time)) throw new PolicyError("Times must look like HH:MM (24 h).");
  assertBookableDay(choice.day, cfg, now);
  const service = await resolveService(choice.service, choice.email);
  const day = await availability({
    day: choice.day,
    resource: choice.resource,
    service: service.name,
    now,
    ignoreAppointmentId,
  });
  const free = day.slots.find((s) => s.time === choice.time);
  if (!free) {
    const times = [...new Set(day.slots.map((s) => s.time))].slice(0, 12);
    throw new PolicyError(
      times.length
        ? `That time is not available. Free times that day: ${times.join(", ")}.`
        : "There are no free times that day. Please choose another day.",
    );
  }
  return {
    start: free.start,
    end: free.end,
    resource: { id: free.resourceId, name: free.resource },
    service,
  };
}

async function notify(
  appointmentId: string,
  kind: "confirmation" | "change" | "cancellation" | "lookup",
  to: string,
  subject: string,
  text: string,
  link?: string,
): Promise<"log" | "resend"> {
  const sent = await sendEmail({ to, subject, text, ...(link ? { link } : {}) }).catch(() => ({
    transport: "resend" as const,
    delivered: false,
  }));
  await db.insert(bookingNotifications).values({
    appointmentId,
    kind,
    recipient: to,
    subject: subject.slice(0, 200),
    transport: sent.transport,
    delivered: sent.delivered,
  });
  return sent.transport;
}

const when = (d: Date) => `${describeLocal(d, cfg.timeZone)} (${cfg.timeZone})`;

async function lockCells(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  appointmentId: string,
  resourceId: string,
  start: Date,
  minutes: number,
) {
  await tx.insert(bookingSlotLocks).values(
    cellsOf(start, minutes, cfg.slotMinutes).map((cellStart) => ({
      resourceId,
      cellStart,
      appointmentId,
    })),
  );
}

export interface BookingRequest extends SlotChoice {
  name: string;
  email: string;
  phone?: string | null;
  via: "assistant" | "staff" | "public";
}

/** Single-use secret of the cancel link; only its SHA-256 is stored. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const appUrl = () => env.BETTER_AUTH_URL.replace(/\/+$/, "");

/** Creates a confirmed appointment and sends the confirmation (logged when no email provider is configured). */
export async function createAppointment(req: BookingRequest, now = new Date()) {
  const email = normEmail(req.email);
  const slot = await checkSlot({ ...req, email }, now);
  const reference = newReference();
  const cancelToken = randomBytes(24).toString("base64url");
  const cancelLink = `${appUrl()}/book/cancel/${cancelToken}`;
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bookingAppointments)
        .values({
          reference,
          resourceId: slot.resource.id,
          service: slot.service.name,
          price: slot.service.price === null ? null : String(slot.service.price),
          currency: slot.service.currency,
          customerName: req.name.trim().slice(0, 120),
          customerEmail: email,
          customerPhone: req.phone?.trim().slice(0, 40) || null,
          cancelTokenHash: hashToken(cancelToken),
          startsAt: slot.start,
          endsAt: slot.end,
          createdVia: req.via,
        })
        .returning({ id: bookingAppointments.id });
      if (!row) throw new Error("appointment not created");
      await lockCells(tx, row.id, slot.resource.id, slot.start, slot.service.minutes);
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new PolicyError("That time was just taken. Please choose another one.");
    throw err;
  }
  const price = priceLabel(slot.service);
  const transport = await notify(
    id,
    "confirmation",
    email,
    `${cfg.business}: your booking ${reference} is confirmed`,
    [
      `Hello ${req.name.trim()},`,
      `Your ${slot.service.name} (${slot.service.minutes} min) with ${slot.resource.name} is confirmed for ${when(slot.start)}.`,
      price ? `Price: ${price}.` : "",
      `Booking reference: ${reference}.`,
      `You can cancel it up to ${cfg.policy.cancelNoticeHours} hours before with this link: ${cancelLink}`,
      `To change it, use this reference and your email.`,
    ]
      .filter(Boolean)
      .join("\n"),
    cancelLink,
  );
  return {
    reference,
    when: when(slot.start),
    day: localDay(slot.start, cfg.timeZone),
    time: localTime(slot.start, cfg.timeZone),
    resource: slot.resource.name,
    service: slot.service.name,
    price,
    email,
    emailTransport: transport,
  };
}

/** An active appointment by reference + email (both required: references alone are not enough). */
async function ownAppointment(reference: string, email: string) {
  const [row] = await db
    .select({ a: bookingAppointments, resource: bookingResources.name })
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(
      and(
        eq(bookingAppointments.reference, reference.trim().toUpperCase()),
        eq(bookingAppointments.customerEmail, normEmail(email)),
        eq(bookingAppointments.status, "confirmed"),
      ),
    )
    .limit(1);
  if (!row) throw new PolicyError("No active booking matches that reference and email.");
  return row;
}

/** Validates a change or cancellation against the notice policy (staff may override it). */
export async function describeOwn(
  reference: string,
  email: string,
  opts: { now?: Date; byStaff?: boolean; action: "change" | "cancel" },
) {
  const row = await ownAppointment(reference, email);
  if (!opts.byStaff && !canChange(row.a.startsAt, cfg, opts.now ?? new Date()))
    throw new PolicyError(
      `Bookings can only be ${opts.action === "cancel" ? "cancelled" : "changed"} at least ${cfg.policy.cancelNoticeHours} hours before they start. Please contact ${cfg.business} directly.`,
    );
  return {
    id: row.a.id,
    reference: row.a.reference,
    when: when(row.a.startsAt),
    resource: row.resource,
    service: row.a.service,
  };
}

export async function cancelAppointment(
  reference: string,
  email: string,
  opts: { now?: Date; byStaff?: boolean } = {},
) {
  const own = await describeOwn(reference, email, { ...opts, action: "cancel" });
  await db.transaction(async (tx) => {
    await tx
      .update(bookingAppointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bookingAppointments.id, own.id));
    await tx.delete(bookingSlotLocks).where(eq(bookingSlotLocks.appointmentId, own.id));
  });
  await notify(
    own.id,
    "cancellation",
    normEmail(email),
    `${cfg.business}: booking ${own.reference} cancelled`,
    `Your ${own.service} with ${own.resource} on ${own.when} has been cancelled.`,
  );
  return { reference: own.reference, when: own.when, cancelled: true as const };
}

export async function moveAppointment(
  reference: string,
  email: string,
  to: SlotChoice,
  opts: { now?: Date; byStaff?: boolean } = {},
) {
  const now = opts.now ?? new Date();
  const own = await describeOwn(reference, email, { now, byStaff: opts.byStaff, action: "change" });
  const slot = await checkSlot(
    { ...to, service: to.service ?? own.service, resource: to.resource ?? own.resource },
    now,
    own.id,
  );
  try {
    await db.transaction(async (tx) => {
      await tx.delete(bookingSlotLocks).where(eq(bookingSlotLocks.appointmentId, own.id));
      await tx
        .update(bookingAppointments)
        .set({
          startsAt: slot.start,
          endsAt: slot.end,
          resourceId: slot.resource.id,
          updatedAt: new Date(),
        })
        .where(eq(bookingAppointments.id, own.id));
      await lockCells(tx, own.id, slot.resource.id, slot.start, slot.service.minutes);
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new PolicyError("That time was just taken. Please choose another one.");
    throw err;
  }
  await notify(
    own.id,
    "change",
    normEmail(email),
    `${cfg.business}: booking ${own.reference} moved`,
    `Your ${own.service} is now with ${slot.resource.name} on ${when(slot.start)}. Reference: ${own.reference}.`,
  );
  return {
    reference: own.reference,
    from: own.when,
    when: when(slot.start),
    resource: slot.resource.name,
    moved: true as const,
  };
}

/** Upcoming appointments of an email address; references are not revealed (they are in the confirmation email). */
/** Same reply whether or not the email has bookings: the chat never reveals someone else's appointments. */
export const LOOKUP_REPLY =
  "If there are upcoming appointments booked with that email address, we have just emailed the list (with booking references) to it.";
/** One lookup email per address per window, so the assistant cannot be used to flood someone's inbox. */
export const LOOKUP_COOLDOWN_MS = 10 * 60_000;

/**
 * "Find my bookings by email" for anonymous chat users: the upcoming appointments (with references) are emailed to
 * that address — only its owner reads them. Returns whether an email went out (for logs/tests, never shown to the
 * person).
 */
export async function emailUpcomingAppointments(email: string, now = new Date()): Promise<boolean> {
  const to = normEmail(email);
  const rows = await db
    .select({
      id: bookingAppointments.id,
      reference: bookingAppointments.reference,
      start: bookingAppointments.startsAt,
      service: bookingAppointments.service,
      resource: bookingResources.name,
    })
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(
      and(
        eq(bookingAppointments.customerEmail, to),
        eq(bookingAppointments.status, "confirmed"),
        gte(bookingAppointments.startsAt, now),
      ),
    )
    .orderBy(asc(bookingAppointments.startsAt))
    .limit(10);
  const first = rows[0];
  if (!first) return false;
  const [recent] = await db
    .select({ id: bookingNotifications.id })
    .from(bookingNotifications)
    .where(
      and(
        eq(bookingNotifications.recipient, to),
        eq(bookingNotifications.kind, "lookup"),
        gt(bookingNotifications.createdAt, new Date(now.getTime() - LOOKUP_COOLDOWN_MS)),
      ),
    )
    .limit(1);
  if (recent) return false;
  await notify(
    first.id,
    "lookup",
    to,
    `Your upcoming appointments at ${cfg.business}`,
    [
      `Your upcoming appointments at ${cfg.business}:`,
      "",
      ...rows.map(
        (r) => `- ${r.service} with ${r.resource} on ${when(r.start)} · reference ${r.reference}`,
      ),
      "",
      `To move or cancel one, give the assistant its reference and this email address (up to ${cfg.policy.cancelNoticeHours} hours before).`,
      "If you did not ask for this, you can ignore this email.",
    ].join("\n"),
  );
  return true;
}

export async function faqEntries() {
  await ensureSeeded();
  return db
    .select({ id: bookingFaq.id, topic: bookingFaq.topic, answer: bookingFaq.answer })
    .from(bookingFaq)
    .orderBy(asc(bookingFaq.sort), asc(bookingFaq.topic));
}

/** Staff view: appointments from yesterday on, with the latest notification of each. */
export async function staffAppointments(opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({
      id: bookingAppointments.id,
      reference: bookingAppointments.reference,
      start: bookingAppointments.startsAt,
      status: bookingAppointments.status,
      service: bookingAppointments.service,
      customerName: bookingAppointments.customerName,
      customerEmail: bookingAppointments.customerEmail,
      createdVia: bookingAppointments.createdVia,
      resource: bookingResources.name,
    })
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(gte(bookingAppointments.startsAt, new Date(now.getTime() - 24 * 3_600_000)))
    .orderBy(asc(bookingAppointments.startsAt))
    .limit(opts.limit ?? 200);
  const ids = rows.map((r) => r.id);
  const notes = ids.length
    ? await db
        .select({
          appointmentId: bookingNotifications.appointmentId,
          kind: bookingNotifications.kind,
          transport: bookingNotifications.transport,
          delivered: bookingNotifications.delivered,
        })
        .from(bookingNotifications)
        .where(inArray(bookingNotifications.appointmentId, ids))
        .orderBy(desc(bookingNotifications.createdAt))
    : [];
  return rows.map((r) => {
    const n = notes.find((x) => x.appointmentId === r.id);
    return {
      ...r,
      when: describeLocal(r.start, cfg.timeZone),
      email: n
        ? `${n.kind}: ${n.transport === "log" ? "logged (no email provider)" : n.delivered ? "sent" : "failed"}`
        : "none",
    };
  });
}
