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
 * Payments at booking time (component payments.booking-deposit.turbineh): one Stripe Checkout session per held
 * booking. Amounts in integer cents, computed on the server; only the signed webhook marks a payment paid or expired.
 */
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => bookingAppointments.id, { onDelete: "cascade" }),
    /** Stripe Checkout session id (cs_…). */
    sessionId: varchar("session_id", { length: 255 }).notNull(),
    /** "deposit" | "full" */
    kind: varchar("kind", { length: 8 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    /** "open" → "paid" | "expired"; "refunded" when a payment arrived for a time that was no longer held. */
    status: varchar("status", { length: 12 }).notNull().default("open"),
    paymentIntent: varchar("payment_intent", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("booking_payments_session_idx").on(t.sessionId),
    index("booking_payments_appointment_idx").on(t.appointmentId),
  ],
);
