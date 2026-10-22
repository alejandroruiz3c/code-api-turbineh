import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inboxMessages, inboxPositions } from "@/db/schema";
import type { InboxMessage } from "./imap";
import { syncInbox, type InboxStore, type SyncReport } from "./sync";

/** PostgreSQL store of the mailbox (component email.inbox.imapflow): messages and position in one transaction. */
export const dbInboxStore: InboxStore = {
  async position(mailbox) {
    const [row] = await db
      .select()
      .from(inboxPositions)
      .where(sql`${inboxPositions.mailbox} = ${mailbox}`)
      .limit(1);
    return row
      ? { uidValidity: row.uidValidity, lastUid: row.lastUid }
      : { uidValidity: null, lastUid: 0 };
  },
  async save(mailbox, uidValidity, messages: InboxMessage[], lastUid) {
    return db.transaction(async (tx) => {
      const inserted = messages.length
        ? await tx
            .insert(inboxMessages)
            .values(
              messages.map((m) => ({
                mailbox,
                uidValidity,
                uid: m.uid,
                messageId: m.messageId,
                fromName: m.from?.name || null,
                fromAddress: m.from?.address ?? null,
                subject: m.subject,
                sentAt: m.date,
                receivedAt: m.receivedAt,
                text: m.text,
                attachments: m.attachments,
                attachmentCount: m.attachments.length,
                seenOnServer: m.seen,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: inboxMessages.id })
        : [];
      await tx
        .insert(inboxPositions)
        .values({ mailbox, uidValidity, lastUid, syncedAt: new Date() })
        .onConflictDoUpdate({
          target: inboxPositions.mailbox,
          // Two runs at once (scheduler + "Sync now"): the position only moves forward within one UIDVALIDITY.
          set: {
            lastUid: sql`case when ${inboxPositions.uidValidity} = excluded.uid_validity
              then greatest(${inboxPositions.lastUid}, excluded.last_uid) else excluded.last_uid end`,
            uidValidity,
            syncedAt: new Date(),
          },
        });
      return inserted.length;
    });
  },
};

/** Synchronises the configured mailbox into the database (no-op when MAIL_IMAP_* is not set). */
export function syncMailbox(): Promise<SyncReport> {
  return syncInbox({ store: dbInboxStore });
}
