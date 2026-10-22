import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { bookingAppointments } from "./component-bookings";

/**
 * Appointment reminders (component domain.reminders.turbineh): one row per appointment, channel and start time. The
 * unique key is what makes reminders idempotent — a second runner call, a retry or two schedulers at once never send a
 * reminder twice for the same appointment and channel; an appointment moved to another time gets its own reminder.
 */
export const bookingReminders = pgTable(
  "booking_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => bookingAppointments.id, { onDelete: "cascade" }),
    /** email | sms | whatsapp */
    channel: varchar("channel", { length: 12 }).notNull(),
    /** The appointment start this reminder is for. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** sending | sent | logged | skipped | retrying | failed | unknown | cancelled */
    status: varchar("status", { length: 12 }).notNull(),
    reason: varchar("reason", { length: 200 }),
    attempts: integer("attempts").notNull().default(1),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** A claimed attempt in progress; past it, the attempt is treated as interrupted ("unknown", never re-sent). */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_reminders_once_idx").on(t.appointmentId, t.channel, t.startsAt),
    index("booking_reminders_retry_idx").on(t.status, t.nextAttemptAt),
  ],
);
