import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Security Pack tables (security.pack.turbineh). `rate_limits`: one fixed-window counter per key (action + user or
 * client address), shared by every instance of the app and expiring with its window (src/security/rate-limit.ts).
 */
export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
