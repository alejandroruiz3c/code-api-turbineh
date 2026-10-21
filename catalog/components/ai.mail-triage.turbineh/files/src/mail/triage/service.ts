import { and, asc, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { financeEntries, inboxMessages, mailTriage } from "@/db/schema";
import { orchestrate } from "@/lib/ai/orchestrator";
import { syncMailbox } from "@/mail/inbox/store";
import type { SyncReport } from "@/mail/inbox/sync";
import { triageConfig as cfg, type FinanceKind } from "./config";
import { buildDigest, type DigestMail } from "./digest";
import { ledgerTotals, type LedgerEntry } from "./ledger";
import { byPriority, triageEmail, type OrchestrateFn } from "./triage";

/**
 * Mailbox triage service (component ai.mail-triage.turbineh): synchronises the mailbox (email.inbox.imapflow), runs
 * every new email through the TurbineH orchestrator once (claimed atomically, so a scheduler and "Sync now" never
 * triage the same email twice), records invoices and payments in the finance ledger, and serves the inbox in
 * priority order, the ledger and the daily digest. Every model call goes through orchestrate() (AI Safety Pack, usage
 * and audit under the "mailbox" workspace).
 */
const MAX_ATTEMPTS = 3;
/** A claim older than this was interrupted (crash, timeout): the email may be triaged again. */
const STALE_CLAIM_MS = 10 * 60_000;

const run: OrchestrateFn = async (req) => {
  const r = await orchestrate(req);
  return { output: r.output, flags: r.flags };
};

/** Claims emails not triaged yet (or whose previous attempt failed or was interrupted). */
async function claim(limit: number): Promise<{ id: string; attempts: number }[]> {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const candidates = await db
    .select({ id: inboxMessages.id, attempts: mailTriage.attempts })
    .from(inboxMessages)
    .leftJoin(mailTriage, eq(mailTriage.messageId, inboxMessages.id))
    .where(
      or(
        isNull(mailTriage.id),
        and(eq(mailTriage.status, "failed"), lt(mailTriage.attempts, MAX_ATTEMPTS)),
        and(eq(mailTriage.status, "running"), lt(mailTriage.claimedAt, stale)),
      ),
    )
    .orderBy(asc(inboxMessages.receivedAt))
    .limit(limit);
  const claimed: { id: string; attempts: number }[] = [];
  for (const c of candidates) {
    if (c.attempts === null) {
      const [row] = await db
        .insert(mailTriage)
        .values({ messageId: c.id, status: "running" })
        .onConflictDoNothing()
        .returning({ attempts: mailTriage.attempts });
      if (row) claimed.push({ id: c.id, attempts: row.attempts });
      continue;
    }
    const [row] = await db
      .update(mailTriage)
      .set({ status: "running", attempts: sql`${mailTriage.attempts} + 1`, claimedAt: new Date() })
      .where(
        and(
          eq(mailTriage.messageId, c.id),
          or(
            eq(mailTriage.status, "failed"),
            and(eq(mailTriage.status, "running"), lt(mailTriage.claimedAt, stale)),
          ),
        ),
      )
      .returning({ attempts: mailTriage.attempts });
    if (row) claimed.push({ id: c.id, attempts: row.attempts });
  }
  return claimed;
}

/** Triages up to `limit` emails; stops at the first failure (e.g. the AI allowance) and leaves the rest for later. */
export async function triagePending(
  limit = 20,
  orchestrateFn: OrchestrateFn = run,
  now = new Date(),
): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 };
  for (const c of await claim(Math.min(Math.max(limit, 1), 50))) {
    const [m] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, c.id));
    if (!m) continue;
    try {
      const r = await triageEmail(
        {
          from: m.fromName
            ? `${m.fromName} <${m.fromAddress ?? ""}>`
            : (m.fromAddress ?? "unknown"),
          subject: m.subject,
          receivedAt: m.receivedAt,
          text: m.text,
          attachments: m.attachments.map((a) => a.filename ?? a.contentType),
        },
        cfg,
        orchestrateFn,
        now,
      );
      await db.transaction(async (tx) => {
        await tx
          .update(mailTriage)
          .set({
            status: "done",
            category: r.category,
            priority: r.priority,
            reason: r.reason.slice(0, 300),
            flags: r.flags.slice(0, 20),
            financeRefused: r.financeRefused?.slice(0, 120) ?? null,
            error: null,
            triagedAt: new Date(),
          })
          .where(eq(mailTriage.messageId, m.id));
        if (r.finance)
          await tx
            .insert(financeEntries)
            .values({
              messageId: m.id,
              kind: r.finance.kind,
              amount: r.finance.amount,
              currency: r.finance.currency,
              occurredOn: r.finance.date,
              issuer: r.finance.issuer,
              description: r.finance.description,
              document: r.finance.document,
            })
            .onConflictDoNothing();
      });
      out.done += 1;
    } catch (err) {
      await db
        .update(mailTriage)
        .set({
          status: "failed",
          error: (err instanceof Error ? err.message : "Error").slice(0, 200),
        })
        .where(eq(mailTriage.messageId, m.id));
      out.failed += 1;
      break;
    }
  }
  return out;
}

/** Reads new mail and triages it (scheduler and "Sync now"). */
export async function syncAndTriage(): Promise<{
  sync: SyncReport;
  triage: { done: number; failed: number };
}> {
  const sync = await syncMailbox();
  const triage = await triagePending();
  return { sync, triage };
}

export interface InboxRow {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  category: string | null;
  priority: string;
  reason: string | null;
  flags: string[];
  status: string;
  handled: boolean;
  finance: { kind: string; amount: string; currency: string } | null;
}

/** The triaged inbox in priority order (not handled first, urgent first, newest first). */
export async function triagedInbox(
  filter: { category?: string; priority?: string; limit?: number } = {},
): Promise<InboxRow[]> {
  const rows = await db
    .select({ m: inboxMessages, t: mailTriage, f: financeEntries })
    .from(inboxMessages)
    .leftJoin(mailTriage, eq(mailTriage.messageId, inboxMessages.id))
    .leftJoin(financeEntries, eq(financeEntries.messageId, inboxMessages.id))
    .where(
      and(
        filter.category ? eq(mailTriage.category, filter.category) : undefined,
        filter.priority ? eq(mailTriage.priority, filter.priority) : undefined,
      ),
    )
    .orderBy(desc(inboxMessages.receivedAt))
    .limit(Math.min(filter.limit ?? 200, 500));
  return rows
    .map(({ m, t, f }) => ({
      id: m.id,
      from: m.fromName ? `${m.fromName} <${m.fromAddress ?? ""}>` : (m.fromAddress ?? "unknown"),
      subject: m.subject,
      receivedAt: m.receivedAt,
      category: t?.category ?? null,
      priority: t?.priority ?? "normal",
      reason: t?.reason ?? null,
      flags: t?.flags ?? [],
      status: t?.status ?? "pending",
      handled: t?.handled ?? false,
      finance: f ? { kind: f.kind, amount: f.amount, currency: f.currency } : null,
    }))
    .sort(byPriority);
}

export async function setHandled(messageId: string, handled: boolean): Promise<void> {
  await db.update(mailTriage).set({ handled }).where(eq(mailTriage.messageId, messageId));
}

export async function lastSync(): Promise<Date | null> {
  const r = await db.execute<{ at: Date | null }>(
    sql`select max(synced_at) as at from inbox_positions`,
  );
  const at = r.rows[0]?.at;
  return at ? new Date(at) : null;
}

/** The ledger entries with the subject of the email each comes from. */
export async function ledger(): Promise<(LedgerEntry & { id: string; corrected: boolean })[]> {
  const rows = await db
    .select({ f: financeEntries, subject: inboxMessages.subject })
    .from(financeEntries)
    .innerJoin(inboxMessages, eq(inboxMessages.id, financeEntries.messageId))
    .orderBy(desc(financeEntries.occurredOn));
  return rows.map(({ f, subject }) => ({
    id: f.id,
    date: f.occurredOn,
    kind: f.kind as FinanceKind,
    amount: f.amount,
    currency: f.currency,
    issuer: f.issuer,
    description: f.description,
    document: f.document,
    source: subject,
    corrected: f.correctedBy !== null,
  }));
}

/** A person corrects the type of an entry (income, expense, investment). */
export async function setEntryKind(id: string, kind: FinanceKind, by: string): Promise<void> {
  if (!cfg.finance.kinds.includes(kind)) throw new Error("kind not recorded by this app");
  await db
    .update(financeEntries)
    .set({ kind, correctedBy: by.slice(0, 320) })
    .where(eq(financeEntries.id, id));
}

/** Who gets the daily digest: MAIL_DIGEST_TO, else the staff list (ADMIN_EMAILS). */
export function digestRecipients(env: Record<string, string | undefined> = process.env): string[] {
  return (env.MAIL_DIGEST_TO || env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
}

/** The daily digest of the last 24 hours, built from the stored triage (no model call). */
export async function dailyDigest(
  now = new Date(),
  appUrl = process.env.BETTER_AUTH_URL ?? "",
): Promise<DigestMail> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db
    .select({ m: inboxMessages, t: mailTriage })
    .from(inboxMessages)
    .innerJoin(mailTriage, eq(mailTriage.messageId, inboxMessages.id))
    .where(and(eq(mailTriage.status, "done"), gte(inboxMessages.receivedAt, since)));
  const recorded = await db
    .select()
    .from(financeEntries)
    .where(gte(financeEntries.createdAt, since))
    .orderBy(asc(financeEntries.occurredOn));
  const all = await ledger();
  return buildDigest(
    rows.map(({ m, t }) => ({
      priority: t.priority ?? "normal",
      category: t.category ?? "other",
      from: m.fromName ? `${m.fromName} <${m.fromAddress ?? ""}>` : (m.fromAddress ?? "unknown"),
      subject: m.subject,
      reason: t.reason ?? "",
      receivedAt: m.receivedAt,
      handled: t.handled,
    })),
    recorded.map((f) => ({
      kind: f.kind,
      amount: f.amount,
      currency: f.currency,
      issuer: f.issuer,
    })),
    cfg,
    appUrl,
    ledgerTotals(all),
  );
}
