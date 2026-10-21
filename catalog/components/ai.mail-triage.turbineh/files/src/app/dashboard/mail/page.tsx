import Link from "next/link";
import { Table } from "@/components/ui/table";
import { inboxConfig, InboxConfigError } from "@/mail/inbox/config";
import { triageConfig, PRIORITIES } from "@/mail/triage/config";
import { lastSync, triagedInbox } from "@/mail/triage/service";
import { currentAdmin, requireMember } from "@/server/authz";
import { toggleHandled } from "./actions";
import { SyncForm } from "./sync-form";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  urgent: "bg-danger-soft text-danger",
  high: "bg-warning-soft text-warning",
  normal: "bg-subtle text-ink",
  low: "bg-subtle text-muted",
};

/** The triaged mailbox (component ai.mail-triage.turbineh), most urgent first. ADMIN_EMAILS only. */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; priority?: string }>;
}) {
  await requireMember();
  if (!(await currentAdmin())) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Mail</h1>
        <p className="text-muted" role="status">
          Only the mailbox owner can see this mail. Ask the owner to add your email to ADMIN_EMAILS.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  const category = triageConfig.categories.includes(sp.category ?? "") ? sp.category : undefined;
  const priority = (PRIORITIES as readonly string[]).includes(sp.priority ?? "")
    ? sp.priority
    : undefined;
  let configured = false;
  let configError: string | null = null;
  try {
    configured = inboxConfig() !== null;
  } catch (err) {
    configError = err instanceof InboxConfigError ? err.message : "Invalid mailbox settings.";
  }
  const [rows, synced] = await Promise.all([triagedInbox({ category, priority }), lastSync()]);
  const filterLink = (q: Record<string, string | undefined>) =>
    `/dashboard/mail?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mail</h1>
        <Link className="text-sm underline" href="/dashboard/finance">
          Finances from your mail
        </Link>
      </div>
      <p className="text-sm text-muted">
        {configError ??
          (configured
            ? `Read-only access to your mailbox. Last sync: ${synced ? synced.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never"}.`
            : "The mailbox is not configured yet: set MAIL_IMAP_HOST, MAIL_IMAP_USER and an app password or OAuth token.")}
      </p>
      <SyncForm />
      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        <Link
          className={!category && !priority ? "font-semibold underline" : "underline"}
          href="/dashboard/mail"
        >
          All
        </Link>
        {PRIORITIES.map((p) => (
          <Link
            key={p}
            className={priority === p ? "font-semibold underline" : "underline"}
            href={filterLink({ priority: p, category })}
          >
            {p}
          </Link>
        ))}
        {triageConfig.categories.map((c) => (
          <Link
            key={c}
            className={category === c ? "font-semibold underline" : "underline"}
            href={filterLink({ category: c, priority })}
          >
            {c}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted">No email yet.</p>
      ) : (
        <Table head={["Priority", "Category", "From", "Subject", "Received", "Why", ""]}>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-testid="mail-row"
              data-priority={r.priority}
              data-category={r.category ?? ""}
              data-handled={r.handled ? "true" : "false"}
              className="border-b border-line align-top"
            >
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[r.priority] ?? TONE.normal}`}
                >
                  {r.status === "done"
                    ? r.priority
                    : r.status === "failed"
                      ? "retrying"
                      : "pending"}
                </span>
              </td>
              <td className="px-3 py-2">{r.category ?? "—"}</td>
              <td className="px-3 py-2">{r.from}</td>
              <td className="px-3 py-2">
                {r.subject || "(no subject)"}
                {r.finance ? (
                  <span className="ml-2 rounded bg-info-soft px-2 py-0.5 text-xs text-info">
                    {r.finance.kind} {r.finance.amount} {r.finance.currency}
                  </span>
                ) : null}
                {r.flags.includes("injection-neutralized") ? (
                  <span className="ml-2 rounded bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    suspicious instructions neutralised
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted">
                {r.receivedAt.toISOString().slice(0, 16).replace("T", " ")}
              </td>
              <td className="px-3 py-2 text-muted">{r.reason ?? ""}</td>
              <td className="px-3 py-2">
                {r.status === "done" ? (
                  <form action={toggleHandled}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="handled" value={r.handled ? "false" : "true"} />
                    <button type="submit" className="text-sm underline">
                      {r.handled ? "Reopen" : "Mark handled"}
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-xs text-muted">
        Every email is classified through the TurbineH orchestrator (AI Safety Pack): its text is
        treated as data, never as instructions. A daily digest of what needs attention is emailed at{" "}
        {triageConfig.digest.at} ({triageConfig.digest.timeZone}).
      </p>
    </div>
  );
}
