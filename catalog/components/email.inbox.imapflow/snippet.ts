// Server code in the app (a scheduled job or a server action): read what arrived since the last run, read-only.
import { InboxConfigError } from "@/mail/inbox/config";
import { syncMailbox } from "@/mail/inbox/store";

export async function readNewMail(): Promise<string> {
  try {
    const r = await syncMailbox();
    if (!r.configured) return "Mailbox not configured (MAIL_IMAP_*).";
    return `${r.stored} new email(s); last UID ${r.lastUid}${r.reset ? " (mailbox read from the start)" : ""}.`;
  } catch (err) {
    if (err instanceof InboxConfigError) return err.message;
    throw err;
  }
}
