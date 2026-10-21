"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InboxConfigError } from "@/mail/inbox/config";
import { setHandled, syncAndTriage } from "@/mail/triage/service";
import { requireAdmin } from "@/server/authz";

/** Mailbox actions (component ai.mail-triage.turbineh): only verified staff emails on ADMIN_EMAILS (deny by default). */
export type SyncState = { error: string | null; done: string | null };

/** "Sync now": reads new mail over IMAP (read-only) and triages it through the orchestrator. */
export async function syncNow(): Promise<SyncState> {
  await requireAdmin();
  try {
    const r = await syncAndTriage();
    revalidatePath("/dashboard/mail");
    revalidatePath("/dashboard/finance");
    if (!r.sync.configured)
      return {
        error: "The mailbox is not configured (MAIL_IMAP_HOST, MAIL_IMAP_USER and a credential).",
        done: null,
      };
    return {
      error: r.triage.failed ? "Some emails could not be triaged now; they will be retried." : null,
      done: `Read ${r.sync.fetched} new ${r.sync.fetched === 1 ? "email" : "emails"}, triaged ${r.triage.done}.`,
    };
  } catch (err) {
    if (err instanceof InboxConfigError) return { error: err.message, done: null };
    // Connection or sign-in failures: say so without details that could carry credentials.
    console.error("[mail] sync failed", err instanceof Error ? err.name : "unknown");
    return {
      error: "Could not read the mailbox. Check the MAIL_IMAP_* settings and try again.",
      done: null,
    };
  }
}

/** Marks an email as handled (or not): handled emails leave the digest and sink in the list. */
export async function toggleHandled(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  await setHandled(id, formData.get("handled") === "true");
  revalidatePath("/dashboard/mail");
}
