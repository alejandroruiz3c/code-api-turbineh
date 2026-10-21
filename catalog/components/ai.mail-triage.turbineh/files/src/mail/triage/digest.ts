import { priorityRank, type MailTriageConfig } from "./config";
import type { LedgerTotal } from "./ledger";

/**
 * The daily digest of the mailbox (component ai.mail-triage.turbineh): the emails that need attention — not handled,
 * at least the configured priority, received since the previous digest window — most urgent first, plus what was
 * recorded in the finance ledger. Built by code from the stored triage; no model call.
 */
export interface DigestItem {
  priority: string;
  category: string;
  from: string;
  subject: string;
  reason: string;
  receivedAt: Date;
  handled: boolean;
}

export interface DigestMail {
  subject: string;
  text: string;
  items: number;
}

export function buildDigest(
  items: readonly DigestItem[],
  recorded: readonly { kind: string; amount: string; currency: string; issuer: string }[],
  cfg: Pick<MailTriageConfig, "digest">,
  appUrl: string,
  totals: readonly LedgerTotal[] = [],
): DigestMail {
  const limit = priorityRank(cfg.digest.minPriority);
  const important = items
    .filter((i) => !i.handled && priorityRank(i.priority) <= limit)
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
  const shown = important.slice(0, cfg.digest.max);
  const lines = shown.map(
    (i, n) =>
      `${n + 1}. [${i.priority.toUpperCase()}] ${i.subject || "(no subject)"} — ${i.from}\n   ${i.reason}`,
  );
  const money = recorded.map((r) => `- ${r.kind}: ${r.amount} ${r.currency} (${r.issuer})`);
  return {
    subject: important.length
      ? `Daily mail digest: ${important.length} ${important.length === 1 ? "email needs" : "emails need"} your attention`
      : "Daily mail digest: nothing urgent",
    items: shown.length,
    text: [
      important.length
        ? "Emails that need your attention, most urgent first:"
        : "No email needs your attention.",
      ...lines,
      important.length > shown.length ? `…and ${important.length - shown.length} more.` : "",
      "",
      money.length ? `Recorded in your finances since the last digest:\n${money.join("\n")}` : "",
      totals.length
        ? `Totals: ${totals.map((t) => `${t.currency} income ${t.income}, expenses ${t.expense}, investments ${t.investment}`).join("; ")}`
        : "",
      `Open your inbox: ${appUrl.replace(/\/+$/, "")}/dashboard/mail`,
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
