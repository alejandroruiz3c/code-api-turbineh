import type { LibraryRow, OrchestrationRow, OwnerReport, PersonRow } from "@turbineh/db";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildOwnerReport, ownerReportRecipient } from "@/server/owner-report";
import { getStaff } from "@/server/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = {
  title: "Usage by account — CODE-API-TURBINEH",
  robots: { index: false },
};

type View = "people" | "library" | "orchestration";
type Search = Record<string, string | string[] | undefined>;
type Cell = string | number | null;
interface Column<R> {
  key: string;
  label: string;
  value: (r: R) => Cell;
  show?: (r: R) => ReactNode;
  right?: boolean;
}

const usd = (v: number | null) =>
  v == null ? "—" : `$${v.toFixed(v !== 0 && Math.abs(v) < 0.1 ? 4 : 2)}`;
const int = (v: number) => v.toLocaleString("en-US");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} %`);
const day = (v: string | null) => (v ? v.slice(0, 10) : "—");
const when = (v: string | null) => (v ? `${v.slice(0, 16).replace("T", " ")} UTC` : "—");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const who = (r: { email: string | null; name: string | null }, fallback: string) => (
  <span>
    <span className="text-ice-2">{r.email ?? fallback}</span>
    {r.name ? <span className="block text-xs text-muted">{r.name}</span> : null}
  </span>
);

const PEOPLE: Column<PersonRow>[] = [
  { key: "email", label: "Person", value: (r) => r.email ?? r.key, show: (r) => who(r, r.key) },
  { key: "products", label: "Products", value: (r) => r.products.join(" + ") },
  { key: "flows", label: "Flows", value: (r) => r.library?.flows ?? 0, right: true },
  { key: "verified", label: "Verified", value: (r) => r.library?.verified ?? 0, right: true },
  {
    key: "notCovered",
    label: "Not covered",
    value: (r) => r.library?.notCovered ?? 0,
    right: true,
  },
  { key: "channels", label: "Channels", value: (r) => r.library?.channels.join(", ") ?? "" },
  {
    key: "requests",
    label: "Orch. requests",
    value: (r) => r.orchestration?.requests ?? 0,
    right: true,
  },
  {
    key: "cost",
    label: "Cost",
    value: (r) => r.orchestration?.costUsd ?? 0,
    show: (r) => usd(r.orchestration?.costUsd ?? null),
    right: true,
  },
  {
    key: "savings",
    label: "Savings",
    value: (r) => r.orchestration?.savingsUsd ?? 0,
    show: (r) => usd(r.orchestration?.savingsUsd ?? null),
    right: true,
  },
  {
    key: "trial",
    label: "Trial left",
    value: (r) => r.orchestration?.trialRemainingUsd ?? null,
    show: (r) =>
      r.orchestration?.trialReached ? (
        <span className="text-bad">reached</span>
      ) : (
        usd(r.orchestration?.trialRemainingUsd ?? null)
      ),
    right: true,
  },
  {
    key: "last",
    label: "Last activity",
    value: (r) => r.lastActivityAt,
    show: (r) => when(r.lastActivityAt),
  },
];

const LIBRARY: Column<LibraryRow>[] = [
  {
    key: "email",
    label: "Account",
    value: (r) => r.email ?? r.ownerId,
    show: (r) => (
      <span>
        {who(r, r.ownerId)}
        <span className="block text-xs text-muted">
          {r.accountKind}
          {r.githubLogin ? ` · @${r.githubLogin}` : ""}
          {r.email ? ` · ${r.emailSource}` : ""}
        </span>
      </span>
    ),
  },
  {
    key: "channels",
    label: "Channels",
    value: (r) =>
      Object.entries(r.channels)
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
  },
  {
    key: "first",
    label: "First seen",
    value: (r) => r.firstSeenAt,
    show: (r) => day(r.firstSeenAt),
  },
  {
    key: "last",
    label: "Last activity",
    value: (r) => r.lastActivityAt,
    show: (r) => when(r.lastActivityAt),
  },
  {
    key: "flows",
    label: "Flows",
    value: (r) => r.flows,
    show: (r) => `${r.flows} (${r.plans} plans · ${r.appBuilds} apps)`,
    right: true,
  },
  { key: "verified", label: "Verified", value: (r) => r.verified, right: true },
  { key: "unverified", label: "Unverified", value: (r) => r.deliveredUnverified, right: true },
  { key: "failed", label: "Failed", value: (r) => r.failed, right: true },
  { key: "notCovered", label: "Not covered", value: (r) => r.notCovered, right: true },
  {
    key: "checks",
    label: "Checks",
    value: (r) => r.checksPassed,
    show: (r) => `${r.checksPassed}/${r.checksTotal}`,
    right: true,
  },
  {
    key: "requirements",
    label: "Req. met / open",
    value: (r) => r.requirementsMet,
    show: (r) => `${r.requirementsMet} / ${r.requirementsOpen}`,
    right: true,
  },
  {
    key: "time",
    label: "Time to verified",
    value: (r) => r.avgSecondsToVerified,
    show: (r) =>
      r.avgSecondsToVerified == null ? "—" : `${Math.round(r.avgSecondsToVerified / 60)} min`,
    right: true,
  },
  {
    key: "delivery",
    label: "Downloads · PRs · pushes · deploys · applies",
    value: (r) => r.downloads + r.pullRequests + r.githubPushes + r.deploys + r.localApplies,
    show: (r) =>
      `${r.downloads} · ${r.pullRequests} · ${r.githubPushes} · ${r.deploys} · ${r.localApplies}`,
    right: true,
  },
  { key: "demand", label: "Uncovered requests", value: (r) => r.uncoveredRequests, right: true },
  {
    key: "capabilities",
    label: "Capabilities · components",
    value: (r) => r.capabilities.length + r.components.length,
    show: (r) => (
      <span className="text-xs">
        {r.capabilities.join(", ") || "—"}
        <span className="block text-muted">{r.components.join(", ")}</span>
      </span>
    ),
  },
  {
    key: "ai",
    label: "AI in their apps",
    value: (r) => r.aiSpentUsd,
    show: (r) =>
      r.aiApps ? `${r.aiApps} app(s) · ${int(r.aiCalls)} calls · ${usd(r.aiSpentUsd)}` : "—",
    right: true,
  },
];

const surfaces = (r: OrchestrationRow) =>
  [
    ["chat", r.bySurface.apiChat],
    ["orchestrate", r.bySurface.orchestrate],
    ["agent", r.bySurface.agent],
    ["mcp", r.bySurface.mcp],
  ]
    .filter(([, s]) => (s as { requests: number }).requests > 0)
    .map(
      ([k, s]) =>
        `${k as string} ${(s as { requests: number }).requests} (${usd((s as { costUsd: number }).costUsd)})`,
    )
    .join(" · ") || "—";

const ORCHESTRATION: Column<OrchestrationRow>[] = [
  {
    key: "email",
    label: "Account",
    value: (r) => r.email ?? r.ownerId,
    show: (r) => (
      <span>
        {who(r, r.ownerId)}
        <span className="block text-xs text-muted">
          {r.kind}
          {r.company ? ` · ${r.company}` : ""}
        </span>
      </span>
    ),
  },
  {
    key: "useCase",
    label: "Use case",
    value: (r) => r.useCase,
    show: (r) => (
      <span className="block max-w-56 truncate text-xs" title={r.useCase ?? ""}>
        {r.useCase ?? "—"}
      </span>
    ),
  },
  { key: "signup", label: "Signup", value: (r) => r.signupAt, show: (r) => day(r.signupAt) },
  {
    key: "last",
    label: "Last activity",
    value: (r) => r.lastActivityAt,
    show: (r) => when(r.lastActivityAt),
  },
  {
    key: "requests",
    label: "Requests (failed)",
    value: (r) => r.requests,
    show: (r) => `${r.requests} (${r.failedRequests})`,
    right: true,
  },
  { key: "calls", label: "Model calls", value: (r) => r.modelCalls, right: true },
  {
    key: "tokens",
    label: "Tokens in / out",
    value: (r) => r.inputTokens + r.outputTokens,
    show: (r) => `${int(r.inputTokens)} / ${int(r.outputTokens)}`,
    right: true,
  },
  {
    key: "latency",
    label: "p50 / p95",
    value: (r) => r.latencyP50Ms,
    show: (r) => `${r.latencyP50Ms ?? "—"} / ${r.latencyP95Ms ?? "—"} ms`,
    right: true,
  },
  { key: "cost", label: "Cost", value: (r) => r.costUsd, show: (r) => usd(r.costUsd), right: true },
  {
    key: "reference",
    label: "Frontier ref.",
    value: (r) => r.referenceCostUsd,
    show: (r) => usd(r.referenceCostUsd),
    right: true,
  },
  {
    key: "savings",
    label: "Savings",
    value: (r) => r.savingsUsd,
    show: (r) => (
      <span className="text-amber">
        {usd(r.savingsUsd)} ({pct(r.savingsPct)})
      </span>
    ),
    right: true,
  },
  {
    key: "trial",
    label: "Trial spent / left",
    value: (r) => r.trial.spentUsd,
    show: (r) =>
      r.trial.capUsd == null ? (
        `${usd(r.trial.spentUsd)} · no cap`
      ) : (
        <span className={r.trial.reached ? "text-bad" : ""}>
          {usd(r.trial.spentUsd)} / {r.trial.reached ? "reached" : usd(r.trial.remainingUsd)}
        </span>
      ),
    right: true,
  },
  {
    key: "surfaces",
    label: "By surface",
    value: (r) => r.requests,
    show: (r) => <span className="text-xs">{surfaces(r)}</span>,
  },
];

function sortRows<R>(
  rows: R[],
  cols: Column<R>[],
  key: string | undefined,
  dir: string | undefined,
): R[] {
  const col = cols.find((c) => c.key === key);
  if (!col) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y))) * sign
    );
  });
}

function Delta({ now, before, money = false }: { now: number; before: number; money?: boolean }) {
  const d = now - before;
  const text = d === 0 ? "=" : `${d > 0 ? "+" : "−"}${money ? usd(Math.abs(d)) : int(Math.abs(d))}`;
  return <span className={d > 0 ? "text-teal" : d < 0 ? "text-amber" : "text-muted"}>{text}</span>;
}

function Kpi({
  label,
  now,
  before,
  money = false,
  hint,
}: {
  label: string;
  now: number;
  before: number;
  money?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{money ? usd(now) : int(now)}</p>
      <p className="mt-1 text-xs text-muted">
        <Delta now={now} before={before} money={money} /> vs {money ? usd(before) : int(before)}
        {hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

function Table<R>({
  rows,
  cols,
  view,
  sort,
  dir,
  base,
  rowKey,
}: {
  rows: R[];
  cols: Column<R>[];
  view: View;
  sort: string | undefined;
  dir: string | undefined;
  base: URLSearchParams;
  rowKey: (r: R) => string;
}) {
  const href = (key: string) => {
    const q = new URLSearchParams(base);
    q.set("view", view);
    q.set("sort", key);
    q.set("dir", sort === key && dir !== "asc" ? "asc" : "desc");
    return `/ops/report?${q.toString()}`;
  };
  if (rows.length === 0)
    return <p className="mt-4 text-sm text-muted">No accounts in this window.</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-navy-900/60 text-xs text-muted">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-3 py-2 ${c.right ? "text-right" : ""}`}
              >
                <Link href={href(c.key)} className="hover:text-ice-2">
                  {c.label}
                  {sort === c.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, cols, sort, dir).map((r) => (
            <tr key={rowKey(r)} className="border-t border-line align-top">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${c.right ? "whitespace-nowrap text-right" : ""}`}
                >
                  {c.show ? c.show(r) : (c.value(r) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SENT: Record<string, string> = {
  sent: "Report sent to your inbox.",
  no_mailer: "Not sent: RESEND_API_KEY is not set on this deployment.",
  invalid_recipient: "Not sent: OWNER_REPORT_EMAIL is not a valid address.",
  failed: "Not sent: the email provider refused it. Try again in a minute.",
};

/**
 * Owner usage report across products (ADR-0061): YES IF library and Intelligence Orchestration per account, the
 * combined per-person view, this week vs the previous one, CSV and "email me now". TurbineH staff only (404 otherwise).
 */
export default async function OwnerReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await getStaff())) notFound();
  const sp = await searchParams;
  const view: View =
    (["people", "library", "orchestration"] as const).find((v) => v === one(sp.view)) ?? "people";
  const days = Number(one(sp.days) ?? 0);
  const until = new Date();
  const report: OwnerReport = await buildOwnerReport({
    until,
    ...(days > 0 ? { since: new Date(until.getTime() - days * 86_400_000) } : {}),
  });
  const base = new URLSearchParams(days > 0 ? { days: String(days) } : {});
  const sort = one(sp.sort);
  const dir = one(sp.dir);
  const tab = (v: View, label: string, count: number) => {
    const q = new URLSearchParams(base);
    q.set("view", v);
    return (
      <Link
        href={`/ops/report?${q.toString()}`}
        className={`rounded-full border px-4 py-1.5 text-sm ${view === v ? "border-teal bg-teal/10 text-white" : "border-line text-muted hover:text-ice-2"}`}
      >
        {label} <span className="text-xs text-muted">{count}</span>
      </Link>
    );
  };
  const range = (d: number, label: string) => {
    const q = new URLSearchParams({ view });
    if (d > 0) q.set("days", String(d));
    return (
      <Link
        href={`/ops/report?${q.toString()}`}
        className={`text-sm ${days === d ? "text-white underline" : "text-muted hover:text-ice-2"}`}
      >
        {label}
      </Link>
    );
  };
  const csv = new URLSearchParams(base);
  csv.set("format", "csv");
  csv.set("view", view);
  const lw = report.library.week;
  const ow = report.orchestration.week;
  const sent = one(sp.sent);

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <p className="eyebrow">Internal · staff only</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">Usage by account</h1>
      <p className="mt-2 text-sm text-muted">
        YES IF library and Intelligence Orchestration, live from the database. Last 7 days vs the 7
        days before; tables{" "}
        {report.window.since ? `since ${day(report.window.since)}` : "since the beginning"}.{" "}
        <Link href="/ops" className="text-ice-2 underline">
          Operations
        </Link>
      </p>
      {sent ? (
        <p
          className={`mt-4 rounded-lg border p-3 text-sm ${sent === "sent" ? "border-teal text-teal" : "border-bad text-bad"}`}
        >
          {SENT[sent] ?? `Not sent (${sent}).`}
        </p>
      ) : null}

      <h2 className="mt-8 text-lg font-semibold text-white">YES IF library · last 7 days</h2>
      <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi
          label="New accounts"
          now={lw.thisWeek.newAccounts}
          before={lw.previousWeek.newAccounts}
        />
        <Kpi
          label="Active accounts"
          now={lw.thisWeek.activeAccounts}
          before={lw.previousWeek.activeAccounts}
        />
        <Kpi
          label="Flows started"
          now={lw.thisWeek.flows}
          before={lw.previousWeek.flows}
          hint={`${lw.thisWeek.verified} verified`}
        />
        <Kpi
          label="Not covered"
          now={lw.thisWeek.notCovered}
          before={lw.previousWeek.notCovered}
          hint={`${lw.thisWeek.failed} failed`}
        />
        <Kpi
          label="Downloads · PRs · deploys"
          now={lw.thisWeek.downloads + lw.thisWeek.pullRequests + lw.thisWeek.deploys}
          before={
            lw.previousWeek.downloads + lw.previousWeek.pullRequests + lw.previousWeek.deploys
          }
          hint={`${lw.thisWeek.downloads} · ${lw.thisWeek.pullRequests} · ${lw.thisWeek.deploys}`}
        />
      </section>

      <h2 className="mt-8 text-lg font-semibold text-white">
        Intelligence Orchestration · last 7 days
      </h2>
      <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="New signups" now={ow.thisWeek.newSignups} before={ow.previousWeek.newSignups} />
        <Kpi
          label="Active accounts"
          now={ow.thisWeek.activeAccounts}
          before={ow.previousWeek.activeAccounts}
        />
        <Kpi
          label="Requests"
          now={ow.thisWeek.requests}
          before={ow.previousWeek.requests}
          hint={`${ow.thisWeek.failedRequests} failed`}
        />
        <Kpi
          label="Cost"
          now={ow.thisWeek.costUsd}
          before={ow.previousWeek.costUsd}
          money
          hint={`ref. ${usd(ow.thisWeek.referenceCostUsd)}`}
        />
        <Kpi
          label="Savings vs frontier ref."
          now={ow.thisWeek.savingsUsd}
          before={ow.previousWeek.savingsUsd}
          money
          hint={pct(ow.thisWeek.savingsPct)}
        />
      </section>

      <section className="mt-10 flex flex-wrap items-center gap-3">
        {tab("people", "People (both products)", report.people.length)}
        {tab("library", "YES IF library", report.library.rows.length)}
        {tab("orchestration", "Intelligence Orchestration", report.orchestration.rows.length)}
        <span className="mx-2 h-5 w-px bg-line" />
        {range(0, "All time")}
        {range(30, "30 d")}
        {range(7, "7 d")}
        <span className="flex-1" />
        <a
          href={`/v1/ops/owner-report?${csv.toString()}`}
          className="rounded-full border border-line px-4 py-1.5 text-sm text-ice-2 hover:border-teal"
        >
          Download CSV
        </a>
        <form method="post" action="/v1/ops/owner-report/send">
          <button
            type="submit"
            className="rounded-full bg-amber px-4 py-1.5 text-sm font-semibold text-navy"
            title={`Sends to ${ownerReportRecipient()}`}
          >
            Email me this report now
          </button>
        </form>
      </section>

      {view === "people" ? (
        <Table
          rows={report.people}
          cols={PEOPLE}
          view={view}
          sort={sort}
          dir={dir}
          base={base}
          rowKey={(r) => r.key}
        />
      ) : view === "library" ? (
        <Table
          rows={report.library.rows}
          cols={LIBRARY}
          view={view}
          sort={sort}
          dir={dir}
          base={base}
          rowKey={(r) => r.ownerId}
        />
      ) : (
        <Table
          rows={report.orchestration.rows}
          cols={ORCHESTRATION}
          view={view}
          sort={sort}
          dir={dir}
          base={base}
          rowKey={(r) => r.ownerId}
        />
      )}

      <p className="mt-6 text-xs text-muted">
        Cost is the internal cost charged to the account; the frontier reference prices the same
        tokens at a frontier model&apos;s list price (estimate). Flows started before channels were
        recorded show as &quot;unrecorded&quot;; downloads count GET
        /v1/plans/&#123;id&#125;/package since the same release (ADR-0061). Weekly email: Mondays
        08:00 Europe/Madrid to {ownerReportRecipient()}.
      </p>
    </main>
  );
}
