import { index, integer, pgTable, smallint, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Weekly opening hours per workspace (recipe bookings). Minutes from 00:00 UTC. */
export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("availability_org_idx").on(t.organizationId, t.weekday)],
);

/** Bookings (recipe bookings). Overlaps among confirmed bookings are prevented inside a locked transaction. */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    customerName: varchar("customer_name", { length: 120 }).notNull(),
    customerEmail: varchar("customer_email", { length: 320 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bookings_org_start_idx").on(t.organizationId, t.startsAt)],
);
