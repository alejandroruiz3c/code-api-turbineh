import { index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * WhatsApp consent and message log (component messaging.whatsapp.meta). WhatsApp's Business Messaging Policy requires
 * the person's opt-in before a business messages them: consent is per number (E.164), "opted_in" when they agreed,
 * "opted_out" after a STOP message; nothing is sent without "opted_in". The log keeps what happened to each message
 * (accepted, then Meta's sent / delivered / read / failed) — never its text.
 */
export const whatsappConsent = pgTable("whatsapp_consent", {
  phone: varchar("phone", { length: 16 }).primaryKey(),
  /** opted_in | opted_out */
  status: varchar("status", { length: 12 }).notNull(),
  source: varchar("source", { length: 120 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    to: varchar("to", { length: 16 }).notNull(),
    template: varchar("template", { length: 512 }).notNull(),
    purpose: varchar("purpose", { length: 40 }).notNull(),
    reference: varchar("reference", { length: 64 }),
    /** accepted | logged | skipped | failed | unknown, then sent | delivered | read | failed from the webhook. */
    status: varchar("status", { length: 16 }).notNull(),
    reason: varchar("reason", { length: 200 }),
    /** Meta's message id (wamid…). */
    providerId: varchar("provider_id", { length: 200 }),
    errorCode: varchar("error_code", { length: 16 }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("whatsapp_messages_provider_id_idx").on(t.providerId),
    index("whatsapp_messages_to_idx").on(t.to),
  ],
);
