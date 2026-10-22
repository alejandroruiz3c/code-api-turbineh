import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Mailbox tables (component email.inbox.imapflow). One mailbox per app (MAIL_IMAP_*): the position of the last
 * synchronisation and the messages read, unique per mailbox, UIDVALIDITY and UID. Attachments are kept as metadata.
 */
export const inboxPositions = pgTable("inbox_positions", {
  mailbox: varchar("mailbox", { length: 200 }).primaryKey(),
  uidValidity: varchar("uid_validity", { length: 32 }).notNull(),
  lastUid: bigint("last_uid", { mode: "number" }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailbox: varchar("mailbox", { length: 200 }).notNull(),
    uidValidity: varchar("uid_validity", { length: 32 }).notNull(),
    uid: bigint("uid", { mode: "number" }).notNull(),
    messageId: varchar("message_id", { length: 300 }),
    fromName: varchar("from_name", { length: 200 }),
    fromAddress: varchar("from_address", { length: 320 }),
    subject: varchar("subject", { length: 500 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    text: text("text").notNull(),
    attachments: jsonb("attachments")
      .$type<{ filename: string | null; contentType: string; size: number }[]>()
      .notNull()
      .default([]),
    attachmentCount: integer("attachment_count").notNull().default(0),
    seenOnServer: boolean("seen_on_server").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbox_messages_uid_idx").on(t.mailbox, t.uidValidity, t.uid),
    index("inbox_messages_received_idx").on(t.receivedAt),
  ],
);
