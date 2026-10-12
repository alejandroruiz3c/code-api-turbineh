import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** One subscription per workspace (component payments.subscriptions.turbineh). Written only by the signed webhook. */
export const subscriptions = pgTable("subscriptions", {
  organizationId: varchar("organization_id", { length: 64 }).primaryKey(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  plan: varchar("plan", { length: 16 }).notNull().default("free"),
  status: varchar("status", { length: 24 }).notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
