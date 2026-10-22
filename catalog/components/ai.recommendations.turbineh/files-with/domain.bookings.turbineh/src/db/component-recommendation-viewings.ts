import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Viewings booked through the recommendation assistant (component ai.recommendations.turbineh with
 * domain.bookings.turbineh): which catalogue record each booking is for, so staff know what to show.
 */
export const recommendationViewings = pgTable(
  "recommendation_viewings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Booking reference (domain.bookings.turbineh). */
    appointmentReference: varchar("appointment_reference", { length: 12 }).notNull(),
    /** Catalogue record reference. */
    itemReference: varchar("item_reference", { length: 24 }).notNull(),
    conversation: varchar("conversation", { length: 120 }).notNull(),
    when: varchar("when_text", { length: 120 }).notNull(),
    customerEmail: varchar("customer_email", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recommendation_viewings_appointment_idx").on(t.appointmentReference),
    index("recommendation_viewings_item_idx").on(t.itemReference),
  ],
);
