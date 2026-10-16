import { escapeHtml, isEmailAddress, type Logger, type Mailer } from "@turbineh/shared";
import type pg from "pg";
import {
  type LibrarySummary,
  type OrchestrationSummary,
  type OwnerReport,
  ownerReportCsv,
  type WeekComparison,
} from "./owner-report.js";

/**
 * Weekly owner report email (ADR-0061): KPIs of both products (this week vs the previous one), the top accounts, a
 * link to the staff page and the three CSV views attached. Sent by the Monday cron (once per ISO week, claimed in
 * `owner_report_sends`) or on demand by staff ("send now").
 */
type Db = Pick<pg.Pool, "query">;

export const DEFAULT_OWNER_REPORT_EMAIL = "alex.ruiz@turbineh.com";
export const MAX_REPORT_ATTEMPTS = 3;

// Brand (docs/PLAN.md, packages/assembler handover): navy page, cream cards, ink text, amber = money/savings.
const NAVY = "#001a5a";
const CREAM = "#fcf6e4";
const CREAM_2 = "#f3ead0";
const INK = "#0b1f5c";
const INK_MUTED = "#4a5f93";
const AMBER = "#f2b24b";
const TEAL = "#34d8c4";

/** Calendar parts of an instant in Europe/Madrid (the owner's time zone). */
export function madridParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    weekday: weekdays.indexOf(String(parts.weekday)) + 1,
  };
}

/** ISO 8601 week of the Madrid calendar date of `d`, e.g. "2026-W42". */
export function isoWeek(d: Date): string {
  const p = madridParts(d);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The cron runs at 06:00 and 07:00 UTC on Mondays (Vercel Cron is UTC): exactly one of them is 08:00 in Madrid
 * (CEST in summer, CET in winter). The send is due on Monday from 08:00 Madrid time; the weekly claim makes the
 * second run a no-op.
 */
export function weeklyReportDue(now: Date): boolean {
  const p = madridParts(now);
  return p.weekday === 1 && p.hour >= 8;
}

const usd = (v: number) => `$${v.toFixed(v !== 0 && Math.abs(v) < 0.1 ? 4 : 2)}`;
const int = (v: number) => v.toLocaleString("en-US");
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} %`);
const day = (v: string | null) => (v ? v.slice(0, 10) : "—");
const delta = (a: number, b: number, money = false) => {
  const d = a - b;
  if (d === 0) return "=";
  const s = money ? usd(Math.abs(d)) : int(Math.abs(d));
  return `${d > 0 ? "+" : "−"}${s}`;
};

type Kpi = { label: string; now: string; before: string; delta: string };

function libraryKpis(w: WeekComparison<LibrarySummary>): Kpi[] {
  const k = (label: string, key: keyof LibrarySummary): Kpi => ({
    label,
    now: int(w.thisWeek[key]),
    before: int(w.previousWeek[key]),
    delta: delta(w.thisWeek[key], w.previousWeek[key]),
  });
  return [
    k("New accounts", "newAccounts"),
    k("Active accounts", "activeAccounts"),
    k("Flows started", "flows"),
    k("Verified", "verified"),
    k("Failed", "failed"),
    k("Not covered", "notCovered"),
    k("Downloads", "downloads"),
    k("Pull requests", "pullRequests"),
    k("Deploys", "deploys"),
  ];
}

function orchestrationKpis(w: WeekComparison<OrchestrationSummary>): Kpi[] {
  const k = (label: string, key: keyof OrchestrationSummary, money = false): Kpi => {
    const a = Number(w.thisWeek[key] ?? 0);
    const b = Number(w.previousWeek[key] ?? 0);
    return {
      label,
      now: money ? usd(a) : int(a),
      before: money ? usd(b) : int(b),
      delta: delta(a, b, money),
    };
  };
  return [
    k("New signups", "newSignups"),
    k("Active accounts", "activeAccounts"),
    k("Requests", "requests"),
    k("Failed requests", "failedRequests"),
    k("Cost", "costUsd", true),
    k("Frontier reference", "referenceCostUsd", true),
    k("Savings", "savingsUsd", true),
    {
      label: "Savings %",
      now: pct(w.thisWeek.savingsPct),
      before: pct(w.previousWeek.savingsPct),
      delta: "",
    },
  ];
}

const th = (t: string, right = false) =>
  `<th style="text-align:${right ? "right" : "left"};padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${INK_MUTED};border-bottom:1px solid ${CREAM_2}">${t}</th>`;
const td = (t: string, right = false, strong = false) =>
  `<td style="text-align:${right ? "right" : "left"};padding:6px 8px;font-size:13px;color:${INK};border-bottom:1px solid ${CREAM_2};${strong ? "font-weight:600;" : ""}">${t}</td>`;

function kpiTable(title: string, rows: Kpi[]): string {
  return (
    `<div style="background:${CREAM};border-radius:12px;padding:16px 16px 8px;margin:16px 0">` +
    `<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${INK}">${escapeHtml(title)}</p>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
    `<tr>${th("Last 7 days")}${th("This week", true)}${th("Previous", true)}${th("Δ", true)}</tr>` +
    rows
      .map(
        (r) =>
          `<tr>${td(escapeHtml(r.label))}${td(r.now, true, true)}${td(r.before, true)}${td(r.delta, true)}</tr>`,
      )
      .join("") +
    `</table></div>`
  );
}

function card(
  title: string,
  headers: [string, boolean][],
  rows: string[][],
  empty: string,
): string {
  return (
    `<div style="background:${CREAM};border-radius:12px;padding:16px 16px 8px;margin:16px 0">` +
    `<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${INK}">${escapeHtml(title)}</p>` +
    (rows.length === 0
      ? `<p style="margin:0 0 8px;font-size:13px;color:${INK_MUTED}">${escapeHtml(empty)}</p>`
      : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
        `<tr>${headers.map(([h, r]) => th(h, r)).join("")}</tr>` +
        rows
          .map(
            (cells) => `<tr>${cells.map((c, i) => td(c, headers[i]?.[1] ?? false)).join("")}</tr>`,
          )
          .join("") +
        `</table>`) +
    `</div>`
  );
}

const who = (r: { email: string | null; name: string | null; ownerId?: string; key?: string }) =>
  r.email ? (r.name ? `${r.name} <${r.email}>` : r.email) : (r.name ?? r.ownerId ?? r.key ?? "—");

export interface ReportEmail {
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: string }[];
}

/** The owner report email: both products' KPIs, top accounts, link to /ops/report and the CSVs. */
export function ownerReportEmail(
  report: OwnerReport,
  opts: { appUrl: string; period: string; staging?: boolean; top?: number },
): ReportEmail {
  const top = opts.top ?? 10;
  const url = `${opts.appUrl.replace(/\/+$/, "")}/ops/report`;
  const lib = libraryKpis(report.library.week);
  const orch = orchestrationKpis(report.orchestration.week);
  const both = report.people.filter((p) => p.products.length === 2).length;
  const subject = `${opts.staging ? "[STAGING] " : ""}TurbineH owner report · ${opts.period}`;
  const libTop = [...report.library.rows]
    .sort(
      (a, b) => b.flows - a.flows || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    )
    .slice(0, top);
  const orchTop = [...report.orchestration.rows]
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests)
    .slice(0, top);
  const peopleTop = report.people.slice(0, top);
  const range = `${day(report.week.since)} → ${day(report.week.until)}`;

  const html =
    `<!doctype html><html><body style="margin:0;background:${NAVY};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:680px;margin:0 auto;padding:28px 20px">` +
    `<p style="margin:0;color:${TEAL};font-size:12px;letter-spacing:.08em;text-transform:uppercase">Owner report${opts.staging ? " · staging" : ""} · ${escapeHtml(opts.period)}</p>` +
    `<h1 style="margin:6px 0 4px;color:${CREAM};font-size:24px">TurbineH — usage by account</h1>` +
    `<p style="margin:0;color:#c0e5ff;font-size:13px">YES IF library and Intelligence Orchestration · last 7 days ${escapeHtml(range)} vs the 7 days before · ${both} person(s) use both products.</p>` +
    kpiTable("YES IF library", lib) +
    kpiTable("Intelligence Orchestration", orch) +
    card(
      "People (both products)",
      [
        ["Person", false],
        ["Products", false],
        ["Flows", true],
        ["Orch. requests", true],
        ["Savings", true],
        ["Last activity", false],
      ],
      peopleTop.map((p) => [
        escapeHtml(who(p)),
        escapeHtml(p.products.join(" + ")),
        int(p.library?.flows ?? 0),
        int(p.orchestration?.requests ?? 0),
        usd(p.orchestration?.savingsUsd ?? 0),
        day(p.lastActivityAt),
      ]),
      "No accounts yet.",
    ) +
    card(
      "Top library accounts",
      [
        ["Account", false],
        ["Channels", false],
        ["Flows", true],
        ["Verified", true],
        ["Not covered", true],
        ["Last activity", false],
      ],
      libTop.map((r) => [
        escapeHtml(who(r)),
        escapeHtml(Object.keys(r.channels).join(", ") || "—"),
        int(r.flows),
        int(r.verified),
        int(r.notCovered),
        day(r.lastActivityAt),
      ]),
      "No library usage yet.",
    ) +
    card(
      "Top orchestration accounts",
      [
        ["Account", false],
        ["Requests", true],
        ["Cost", true],
        ["Savings", true],
        ["Trial left", true],
        ["Last activity", false],
      ],
      orchTop.map((r) => [
        escapeHtml(who(r)),
        int(r.requests),
        usd(r.costUsd),
        `<span style="color:#7a5200">${usd(r.savingsUsd)}</span> (${pct(r.savingsPct)})`,
        r.trial.remainingUsd === null
          ? "no cap"
          : r.trial.reached
            ? "reached"
            : usd(r.trial.remainingUsd),
        day(r.lastActivityAt),
      ]),
      "No orchestration usage yet.",
    ) +
    `<p style="margin:24px 0 8px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${AMBER};color:${NAVY};font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px">Open the full report</a></p>` +
    `<p style="margin:12px 0 0;color:#8fa6d4;font-size:12px;line-height:1.5">Attached: people.csv, library.csv and orchestration.csv (all accounts, since the beginning). ` +
    `Totals since the beginning: ${int(report.library.totals.flows)} flows · ${int(report.orchestration.totals.requests)} orchestration requests · ${usd(report.orchestration.totals.costUsd)} cost · ${usd(report.orchestration.totals.savingsUsd)} saved vs the frontier reference (list price). ` +
    `Staff only: contact data and internal cost. TurbineH · YES IF for Builders</p>` +
    `</div></body></html>`;

  const line = (k: Kpi) =>
    `  ${k.label}: ${k.now} (previous ${k.before}${k.delta ? `, ${k.delta}` : ""})`;
  const text = [
    `TurbineH owner report · ${opts.period}${opts.staging ? " · STAGING" : ""}`,
    `Last 7 days ${range} vs the 7 days before. ${both} person(s) use both products.`,
    "",
    "YES IF library",
    ...lib.map(line),
    "",
    "Intelligence Orchestration",
    ...orch.map(line),
    "",
    "Top orchestration accounts",
    ...orchTop.map(
      (r) =>
        `  ${who(r)} · ${r.requests} requests · ${usd(r.costUsd)} · saved ${usd(r.savingsUsd)} (${pct(r.savingsPct)})`,
    ),
    "",
    "Top library accounts",
    ...libTop.map(
      (r) =>
        `  ${who(r)} · ${r.flows} flows · ${r.verified} verified · ${r.notCovered} not covered`,
    ),
    "",
    `Full report: ${url}`,
    "Attached: people.csv, library.csv, orchestration.csv.",
  ].join("\n");

  return {
    subject,
    html,
    text,
    attachments: [
      { filename: `people-${opts.period}.csv`, content: ownerReportCsv(report, "people") },
      { filename: `library-${opts.period}.csv`, content: ownerReportCsv(report, "library") },
      {
        filename: `orchestration-${opts.period}.csv`,
        content: ownerReportCsv(report, "orchestration"),
      },
    ],
  };
}

/** Claims this week's send (or a failed/stale one for a retry). Returns the attempt number, or null when not ours. */
export async function claimWeeklyReport(db: Db, period: string): Promise<number | null> {
  const res = await db.query<{ attempts: number }>(
    `INSERT INTO owner_report_sends (period, kind) VALUES ($1, 'weekly')
     ON CONFLICT (period, kind) DO UPDATE SET status = 'sending', attempts = owner_report_sends.attempts + 1,
       claimed_at = now()
     WHERE (owner_report_sends.status = 'failed' AND owner_report_sends.attempts < $2)
        OR (owner_report_sends.status = 'sending' AND owner_report_sends.claimed_at < now() - interval '15 minutes')
     RETURNING attempts`,
    [period, MAX_REPORT_ATTEMPTS],
  );
  return res.rows[0]?.attempts ?? null;
}

async function settleWeekly(db: Db, period: string, ok: boolean, id: string | null): Promise<void> {
  await db.query(
    `UPDATE owner_report_sends SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() END, email_id = $3
     WHERE period = $1 AND kind = 'weekly'`,
    [period, ok ? "sent" : "failed", id],
  );
}

export type OwnerReportSend =
  | { status: "sent"; period: string; id: string | null }
  | { status: "already_sent" | "no_mailer" | "invalid_recipient" | "dry_run"; period: string }
  | { status: "failed"; period: string; error: string };

/**
 * Sends the report. `weekly`: once per ISO week (claimed first; a failure is retried by the next run, at most 3
 * attempts). `manual`: always sends (staff "send now"). `dryRun` builds everything but sends nothing. Never throws on
 * a provider error; logs carry the period and status only, never the address or the content.
 */
export async function sendOwnerReport(
  db: Db,
  mailer: Mailer | null,
  input: {
    kind: "weekly" | "manual";
    to: string;
    now?: Date;
    staging?: boolean;
    dryRun?: boolean;
    build: () => Promise<OwnerReport>;
    log?: Logger;
  },
): Promise<OwnerReportSend> {
  const now = input.now ?? new Date();
  const period = isoWeek(now);
  if (!mailer) return { status: "no_mailer", period };
  if (!isEmailAddress(input.to)) return { status: "invalid_recipient", period };
  if (input.dryRun) {
    await input.build();
    return { status: "dry_run", period };
  }
  const attempt = input.kind === "weekly" ? await claimWeeklyReport(db, period) : 0;
  if (input.kind === "weekly" && attempt === null) return { status: "already_sent", period };
  try {
    const report = await input.build();
    const email = ownerReportEmail(report, {
      appUrl: mailer.appUrl,
      period,
      ...(input.staging ? { staging: true } : {}),
    });
    const sent = await mailer.send({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
      ...(input.kind === "weekly" ? { idempotencyKey: `owner-report-${period}-${attempt}` } : {}),
    });
    if (input.kind === "weekly") await settleWeekly(db, period, sent.ok, sent.ok ? sent.id : null);
    if (!sent.ok) {
      input.log?.error("owner report not sent", { period, kind: input.kind, status: sent.status });
      return { status: "failed", period, error: sent.error };
    }
    input.log?.info("owner report sent", { period, kind: input.kind });
    return { status: "sent", period, id: sent.id };
  } catch (err) {
    if (input.kind === "weekly") await settleWeekly(db, period, false, null).catch(() => undefined);
    input.log?.error("owner report failed", {
      period,
      kind: input.kind,
      error: err instanceof Error ? err.name : "error",
    });
    return {
      status: "failed",
      period,
      error: err instanceof Error ? err.message.slice(0, 200) : "error",
    };
  }
}

/** Counts a package download (GET /v1/plans/{id}/package). Numbers only. */
export async function recordFlowDownload(
  db: Db,
  input: { buildId: string; ownerId: string; format: string },
): Promise<void> {
  await db.query("INSERT INTO flow_downloads (build_id, owner_id, format) VALUES ($1, $2, $3)", [
    input.buildId,
    input.ownerId,
    input.format.slice(0, 20),
  ]);
}
