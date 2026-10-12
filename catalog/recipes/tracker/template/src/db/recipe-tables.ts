import { date, index, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Personal trackers (recipe tracker): each user only sees their own. */
export const trackers = pgTable(
  "trackers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull(), // "habit" (done / not done) or "quantity"
    unit: varchar("unit", { length: 16 }).notNull().default(""),
    dailyTarget: numeric("daily_target", { precision: 12, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trackers_user_idx").on(t.organizationId, t.userId)],
);

export const trackerLogs = pgTable(
  "tracker_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 }).notNull(),
    day: date("day").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }).notNull(),
    note: varchar("note", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tracker_logs_day_idx").on(t.trackerId, t.day)],
);
