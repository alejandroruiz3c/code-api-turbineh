import { index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * SMS consent and message log (component messaging.sms.twilio). Consent is per phone number (E.164): "opted_in" when
 * the person agreed (e.g. a reminder box on a form, or a START reply), "opted_out" after a STOP reply or Twilio's
 * unsubscribed-recipient error; nothing is sent to a number without "opted_in". The log keeps what happened to each
 * message — never its text.
 */
export const smsConsent = pgTable("sms_consent", {
  phone: varchar("phone", { length: 16 }).primaryKey(),
  /** opted_in | opted_out */
  status: varchar("status", { length: 12 }).notNull(),
  /** Where it came from: "form:<reference>", "keyword:STOP", "provider:21610"… */
  source: varchar("source", { length: 120 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    to: varchar("to", { length: 16 }).notNull(),
    /** What the message is for ("reminder", "test"…), set by the caller. */
    purpose: varchar("purpose", { length: 40 }).notNull(),
    /** The caller's reference (e.g. a booking reference). */
    reference: varchar("reference", { length: 64 }),
    /** sent | logged | skipped | failed | unknown, then Twilio's delivery status (delivered, undelivered…). */
    status: varchar("status", { length: 16 }).notNull(),
    reason: varchar("reason", { length: 200 }),
    providerSid: varchar("provider_sid", { length: 40 }),
    errorCode: varchar("error_code", { length: 16 }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sms_messages_provider_sid_idx").on(t.providerSid),
    index("sms_messages_to_idx").on(t.to),
  ],
);
