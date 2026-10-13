import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Waitlist signups (component growth.waitlist.turbineh). Public writes go through joinWaitlist and confirmSignup only;
 * the confirmation link's token is stored as a SHA-256 hash and doubles as the person's private status link.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    /** pending (not confirmed yet) | confirmed */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** Public code of the person's referral link (/?ref=<code>). */
    referralCode: varchar("referral_code", { length: 16 }).notNull(),
    /** Who referred this person (their signup id), if anyone. */
    referredBy: uuid("referred_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("waitlist_signups_email_idx").on(t.email),
    uniqueIndex("waitlist_signups_token_idx").on(t.tokenHash),
    uniqueIndex("waitlist_signups_referral_idx").on(t.referralCode),
    index("waitlist_signups_referred_by_idx").on(t.referredBy),
  ],
);
