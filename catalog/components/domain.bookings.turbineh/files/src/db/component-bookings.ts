import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Booking domain tables (component domain.bookings.turbineh). One business per app: its team, appointments, the
 * answers the assistant may give and a log of every notification sent.
 */
export const bookingResources = pgTable("booking_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingAppointments = pgTable(
  "booking_appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short code sent to the person; needed (with their email) to move or cancel. */
    reference: varchar("reference", { length: 12 }).notNull(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => bookingResources.id),
    service: varchar("service", { length: 80 }).notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 8 }),
    customerName: varchar("customer_name", { length: 120 }).notNull(),
    customerEmail: varchar("customer_email", { length: 320 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 40 }),
    /** SHA-256 of the cancel link's token (the link itself is only in the confirmation email). */
    cancelTokenHash: varchar("cancel_token_hash", { length: 64 }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"),
    /** "assistant" | "staff" */
    createdVia: varchar("created_via", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_appointments_reference_idx").on(t.reference),
    uniqueIndex("booking_appointments_cancel_token_idx").on(t.cancelTokenHash),
    index("booking_appointments_start_idx").on(t.startsAt),
    index("booking_appointments_email_idx").on(t.customerEmail),
  ],
);

/**
 * Double-booking guard at the database level: one row per occupied time cell of a resource. The primary key makes a
 * second booking of the same cell fail, even when two requests race.
 */
export const bookingSlotLocks = pgTable(
  "booking_slot_locks",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => bookingResources.id),
    cellStart: timestamp("cell_start", { withTimezone: true }).notNull(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => bookingAppointments.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.cellStart] }),
    index("booking_slot_locks_appointment_idx").on(t.appointmentId),
  ],
);

/** Time a team member (or room) is not bookable: holidays, breaks, training. Staff add and remove it. */
export const bookingTimeOff = pgTable(
  "booking_time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => bookingResources.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: varchar("reason", { length: 120 }),
    createdBy: varchar("created_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("booking_time_off_resource_idx").on(t.resourceId, t.startsAt)],
);

/** Answers the assistant may give (topics come from the request; staff write or correct the answers). */
export const bookingFaq = pgTable(
  "booking_faq",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: varchar("topic", { length: 120 }).notNull(),
    answer: text("answer"),
    sort: integer("sort").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("booking_faq_topic_idx").on(t.topic)],
);

/** Every confirmation/change/cancellation email: transport "log" when no email provider is configured. */
export const bookingNotifications = pgTable(
  "booking_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => bookingAppointments.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 200 }).notNull(),
    transport: varchar("transport", { length: 16 }).notNull(),
    delivered: boolean("delivered").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("booking_notifications_appointment_idx").on(t.appointmentId)],
);
