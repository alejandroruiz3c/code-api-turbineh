import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Waitlist signups (recipe landing-waitlist). Public writes go through joinWaitlist only. */
export const waitlistEntries = pgTable("waitlist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
