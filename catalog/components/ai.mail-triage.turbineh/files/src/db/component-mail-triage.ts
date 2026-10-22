import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { inboxMessages } from "./component-inbox";

/**
 * Mailbox triage tables (component ai.mail-triage.turbineh): the triage of each email read by email.inbox.imapflow
 * (category, priority, reason, safety flags, handled) and the finance ledger extracted from invoices and payments
 * (one entry per email at most; amounts as exact decimals).
 */
export const mailTriage = pgTable(
  "mail_triage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => inboxMessages.id, { onDelete: "cascade" }),
    /** running | done | failed */
    status: varchar("status", { length: 16 }).notNull().default("running"),
    category: varchar("category", { length: 24 }),
    priority: varchar("priority", { length: 8 }),
    reason: varchar("reason", { length: 300 }),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    financeRefused: varchar("finance_refused", { length: 120 }),
    attempts: integer("attempts").notNull().default(1),
    error: varchar("error", { length: 200 }),
    handled: boolean("handled").notNull().default(false),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("mail_triage_message_idx").on(t.messageId),
    index("mail_triage_status_idx").on(t.status),
  ],
);

export const financeEntries = pgTable(
  "finance_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => inboxMessages.id, { onDelete: "cascade" }),
    /** income | expense | investment */
    kind: varchar("kind", { length: 16 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    issuer: varchar("issuer", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    /** invoice | receipt | payment | statement | other */
    document: varchar("document", { length: 16 }).notNull(),
    /** Set when a person corrected the type (the AI's answer is never silently trusted over theirs). */
    correctedBy: varchar("corrected_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("finance_entries_message_idx").on(t.messageId),
    index("finance_entries_date_idx").on(t.occurredOn),
  ],
);
