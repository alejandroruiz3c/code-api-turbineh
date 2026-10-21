import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { bookingConfig } from "@/bookings/config";
import { db } from "@/db/client";
import { bookingAppointments, bookingReminders, bookingResources } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { smsChannel } from "./channels/sms";
import type { ChannelOutcome, ReminderChannel } from "./channels/types";
import { whatsappChannel } from "./channels/whatsapp";
import { reminderConfig, type Channel } from "./config";
import {
  dueAt,
  emailReminder,
  HOUR_MS,
  retryDelayMs,
  smsReminder,
  whatsappReminderParams,
  type ReminderFacts,
} from "./schedule";

/**
 * Appointment reminders (component domain.reminders.turbineh). The cron route of jobs.scheduled.turbineh runs
 * `runDueReminders` on every call (task "booking-reminders"): each confirmed appointment whose reminder time has come
 * gets one reminder per configured channel — email, SMS (messaging.sms.twilio) or WhatsApp (messaging.whatsapp.meta).
 *  - Once: a reminder is claimed by inserting (appointment, channel, start time) under a unique key before anything is
 *    sent; concurrent or repeated calls find the row and send nothing.
 *  - Cancelled appointments are never reminded (only confirmed ones are read, and a pending retry is cancelled); a
 *    moved appointment is reminded for its new time.
 *  - SMS and WhatsApp go only to people who agreed on the booking form and have not replied STOP since.
 *  - Failures that may pass later are retried on later calls with backoff (next_attempt_at); an attempt interrupted
 *    mid-send is marked "unknown" and never re-sent.
 */
const LEASE_MS = 3 * 60_000;
const BATCH = 100;

export const reminderChannels: Record<Exclude<Channel, "email">, ReminderChannel | null> = {
  sms: smsChannel,
  whatsapp: whatsappChannel,
};

/** Configured channels that need a messaging component which is not in the app: a wrong build fails at start-up. */
export function missingChannels(channels: readonly Channel[] = reminderConfig.channels): Channel[] {
  return channels.filter((c) => c !== "email" && !reminderChannels[c]);
}
const missing = missingChannels();
if (missing.length)
  throw new Error(
    `Reminders by ${missing.join(", ")} need the matching messaging component (messaging.sms.twilio, messaging.whatsapp.meta).`,
  );

/** Channels whose consent the booking form asks for (people choose SMS or WhatsApp; email needs no extra consent). */
export const consentChannels = (): ReminderChannel[] =>
  reminderConfig.channels.flatMap((c) =>
    c === "email" ? [] : reminderChannels[c] ? [reminderChannels[c] as ReminderChannel] : [],
  );

/** Records consent given on the booking form for each channel the person ticked. */
export async function recordBookingConsent(input: {
  reference: string;
  phone: string | null;
  channels: readonly ("sms" | "whatsapp")[];
}): Promise<void> {
  if (!input.phone) return;
  for (const id of input.channels) {
    const channel = reminderChannels[id];
    if (channel && reminderConfig.channels.includes(id))
      await channel.recordConsent(input.phone, `booking-form:${input.reference}`);
  }
}

type Due = {
  id: string;
  reference: string;
  startsAt: Date;
  createdAt: Date;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  service: string;
  resource: string;
};

async function send(channel: Channel, a: Due): Promise<ChannelOutcome> {
  const facts: ReminderFacts = {
    reference: a.reference,
    customerName: a.customerName,
    service: a.service,
    resource: a.resource,
    startsAt: a.startsAt,
    business: bookingConfig.business,
    timeZone: bookingConfig.timeZone,
  };
  if (channel === "email") {
    const mail = emailReminder(facts, bookingConfig.policy.cancelNoticeHours);
    const r = await sendEmail({ to: a.customerEmail, ...mail }).catch(() => null);
    if (!r) return { status: "failed", reason: "email error", retryable: true, retryAfterMs: null };
    if (r.transport === "log") return { status: "logged", reason: "no email provider configured" };
    return r.delivered
      ? { status: "sent", reason: null }
      : { status: "failed", reason: "email not accepted", retryable: true, retryAfterMs: null };
  }
  const impl = reminderChannels[channel];
  if (!impl) return { status: "skipped", reason: `${channel} is not available in this app` };
  if (!a.customerPhone) return { status: "skipped", reason: "no phone number" };
  return impl.send({
    reference: a.reference,
    phone: a.customerPhone,
    text: smsReminder(facts),
    templateParams: whatsappReminderParams(facts),
  });
}

async function settle(
  rowId: string,
  attempt: number,
  outcome: ChannelOutcome,
  now: Date,
  random?: () => number,
): Promise<"sent" | "skipped" | "failed"> {
  const set: Partial<typeof bookingReminders.$inferInsert> = {
    leaseUntil: null,
    updatedAt: new Date(),
    reason: outcome.reason?.slice(0, 200) ?? null,
  };
  let result: "sent" | "skipped" | "failed";
  if (outcome.status === "sent" || outcome.status === "logged") {
    Object.assign(set, { status: outcome.status, sentAt: new Date(), nextAttemptAt: null });
    result = "sent";
  } else if (outcome.status === "skipped") {
    Object.assign(set, { status: "skipped", nextAttemptAt: null });
    result = "skipped";
  } else if (outcome.status === "unknown") {
    Object.assign(set, { status: "unknown", nextAttemptAt: null });
    result = "failed";
  } else if (
    outcome.status === "failed" &&
    outcome.retryable &&
    attempt < reminderConfig.maxAttempts
  ) {
    const wait = retryDelayMs(attempt, outcome.retryAfterMs, random);
    Object.assign(set, { status: "retrying", nextAttemptAt: new Date(now.getTime() + wait) });
    result = "failed";
  } else {
    Object.assign(set, { status: "failed", nextAttemptAt: null });
    result = "failed";
  }
  await db.update(bookingReminders).set(set).where(eq(bookingReminders.id, rowId));
  return result;
}

/** One runner call: new reminders that are due, retries that are due, and cleanup. Never throws per reminder. */
export async function runDueReminders(
  now: Date = new Date(),
  opts: { random?: () => number } = {},
): Promise<{ sent: number; skipped: number; failed: number }> {
  const report = { sent: 0, skipped: 0, failed: 0 };
  const hoursBefore = reminderConfig.hoursBefore;
  // Interrupted attempts (lease expired while "sending"): the message may have left — never sent again.
  await db
    .update(bookingReminders)
    .set({ status: "unknown", reason: "attempt interrupted; not re-sent", leaseUntil: null })
    .where(and(eq(bookingReminders.status, "sending"), lt(bookingReminders.leaseUntil, now)));
  // Pending retries of appointments that were cancelled or moved: nothing more is sent for them.
  await db.execute(sql`
    update booking_reminders r set status = 'cancelled', next_attempt_at = null, updated_at = now(),
      reason = case when a.status <> 'confirmed' then 'appointment cancelled' else 'appointment moved' end
    from booking_appointments a
    where r.appointment_id = a.id and r.status = 'retrying'
      and (a.status <> 'confirmed' or a.starts_at <> r.starts_at)`);

  const select = {
    id: bookingAppointments.id,
    reference: bookingAppointments.reference,
    startsAt: bookingAppointments.startsAt,
    createdAt: bookingAppointments.createdAt,
    customerName: bookingAppointments.customerName,
    customerEmail: bookingAppointments.customerEmail,
    customerPhone: bookingAppointments.customerPhone,
    service: bookingAppointments.service,
    resource: bookingResources.name,
  };
  // Confirmed appointments whose reminder time has come, booked before it.
  const due: Due[] = await db
    .select(select)
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(
      and(
        eq(bookingAppointments.status, "confirmed"),
        gt(bookingAppointments.startsAt, now),
        lte(bookingAppointments.startsAt, new Date(now.getTime() + hoursBefore * HOUR_MS)),
        sql`${bookingAppointments.createdAt} <= ${bookingAppointments.startsAt} - make_interval(hours => ${hoursBefore})`,
      ),
    )
    .orderBy(asc(bookingAppointments.startsAt))
    .limit(BATCH);
  for (const a of due) {
    for (const channel of reminderConfig.channels) {
      const [claimed] = await db
        .insert(bookingReminders)
        .values({
          appointmentId: a.id,
          channel,
          startsAt: a.startsAt,
          dueAt: dueAt(a.startsAt, hoursBefore),
          status: "sending",
          attempts: 1,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
        })
        .onConflictDoNothing()
        .returning({ id: bookingReminders.id });
      if (!claimed) continue; // already reminded (or being reminded) for this time on this channel
      const outcome = await send(channel, a).catch((): ChannelOutcome => ({
        status: "failed",
        reason: "channel error",
        retryable: true,
        retryAfterMs: null,
      }));
      report[await settle(claimed.id, 1, outcome, now, opts.random)]++;
    }
  }

  // Retries that are due, for appointments still confirmed at the same time.
  const retries = await db
    .select({ row: bookingReminders, a: select })
    .from(bookingReminders)
    .innerJoin(bookingAppointments, eq(bookingAppointments.id, bookingReminders.appointmentId))
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(
      and(
        eq(bookingReminders.status, "retrying"),
        lte(bookingReminders.nextAttemptAt, now),
        eq(bookingAppointments.status, "confirmed"),
        eq(bookingAppointments.startsAt, bookingReminders.startsAt),
        gt(bookingAppointments.startsAt, now),
      ),
    )
    .limit(BATCH);
  for (const { row, a } of retries) {
    const [claimed] = await db
      .update(bookingReminders)
      .set({
        status: "sending",
        attempts: row.attempts + 1,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        updatedAt: new Date(),
      })
      .where(and(eq(bookingReminders.id, row.id), eq(bookingReminders.status, "retrying")))
      .returning({ id: bookingReminders.id });
    if (!claimed) continue;
    const outcome = await send(row.channel as Channel, a).catch((): ChannelOutcome => ({
      status: "failed",
      reason: "channel error",
      retryable: true,
      retryAfterMs: null,
    }));
    report[await settle(row.id, row.attempts + 1, outcome, now, opts.random)]++;
  }
  return report;
}

/** Staff view: reminders of recent and upcoming appointments, with what is planned for those not due yet. */
export async function staffReminders(now: Date = new Date()) {
  const from = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const appointments = await db
    .select({
      id: bookingAppointments.id,
      reference: bookingAppointments.reference,
      startsAt: bookingAppointments.startsAt,
      createdAt: bookingAppointments.createdAt,
      status: bookingAppointments.status,
      customerName: bookingAppointments.customerName,
    })
    .from(bookingAppointments)
    .where(gte(bookingAppointments.startsAt, from))
    .orderBy(asc(bookingAppointments.startsAt))
    .limit(200);
  const ids = appointments.map((a) => a.id);
  const rows = ids.length
    ? await db
        .select()
        .from(bookingReminders)
        .where(inArray(bookingReminders.appointmentId, ids))
        .orderBy(desc(bookingReminders.createdAt))
    : [];
  return appointments.flatMap((a) =>
    reminderConfig.channels.map((channel) => {
      const row = rows.find(
        (r) =>
          r.appointmentId === a.id &&
          r.channel === channel &&
          r.startsAt.getTime() === a.startsAt.getTime(),
      );
      const due = dueAt(a.startsAt, reminderConfig.hoursBefore);
      const planned =
        a.status !== "confirmed"
          ? "not sent (appointment cancelled)"
          : a.createdAt > due
            ? "not sent (booked after the reminder time)"
            : a.startsAt <= now
              ? "not sent"
              : "scheduled";
      return {
        key: `${a.id}:${channel}`,
        reference: a.reference,
        customerName: a.customerName,
        startsAt: a.startsAt,
        channel,
        dueAt: due,
        status: row?.status ?? planned,
        reason: row?.reason ?? null,
        attempts: row?.attempts ?? 0,
      };
    }),
  );
}
