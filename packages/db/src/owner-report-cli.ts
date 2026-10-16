/**
 * Owner usage report across products (ADR-0061) in the terminal.
 *
 *   pnpm --filter @turbineh/db owner-report [--days N] [--product people|library|orchestration] [--json | --csv]
 *   pnpm --filter @turbineh/db orchestration-report [--days N] [--json | --csv]      (= --product orchestration)
 *
 * Without --days: every account since the beginning. Always prints the last 7 days against the 7 days before.
 * Reads DATABASE_URL (and DATABASE_CA_CERT for the managed database) from the environment or .env.local; trial cap
 * from AI_TRIAL_CAP_USD (default 2). Contact data stays in this terminal: never paste it in public.
 */
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { closePool, getPool } from "./client.js";
import { ownerReportCsv, ownerUsageReport, type ReportView } from "./owner-report.js";

loadLocalEnv();
const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const days = Number(value("--days") ?? 0);
const view = (value("--product") ?? "people") as ReportView;
if (!["people", "library", "orchestration"].includes(view)) {
  console.error("--product must be people, library or orchestration");
  process.exit(2);
}
const until = new Date();
const report = await ownerUsageReport(
  getPool(readEnv().DATABASE_URL),
  { until, ...(days > 0 ? { since: new Date(until.getTime() - days * 86_400_000) } : {}) },
  {
    trialCapUsd: Number(process.env.AI_TRIAL_CAP_USD || 2),
    exemptOwners: [process.env.AI_TRIAL_EXEMPT_OWNERS, process.env.OPS_OWNER_IDS ?? "ops:smoke"]
      .filter(Boolean)
      .join(",")
      .split(","),
  },
);
await closePool();

const usd = (v: number) => `$${v.toFixed(4)}`;
if (args.includes("--json")) {
  console.log(JSON.stringify(view === "people" ? report : report[view], null, 2));
} else if (args.includes("--csv")) {
  process.stdout.write(ownerReportCsv(report, view));
} else {
  const w = report.week;
  const lw = report.library.week;
  const ow = report.orchestration.week;
  console.log(
    `Owner report · ${report.window.since ? `since ${report.window.since.slice(0, 10)}` : "since the beginning"}`,
  );
  console.log(
    `Last 7 days (${w.since.slice(0, 10)} → ${w.until.slice(0, 10)}) vs previous 7 days:`,
  );
  console.log(
    `  library: ${lw.thisWeek.newAccounts} new / ${lw.thisWeek.activeAccounts} active accounts (prev ${lw.previousWeek.newAccounts} / ${lw.previousWeek.activeAccounts}) · ${lw.thisWeek.flows} flows (prev ${lw.previousWeek.flows}) · ${lw.thisWeek.verified} verified · ${lw.thisWeek.notCovered} not covered`,
  );
  console.log(
    `  orchestration: ${ow.thisWeek.newSignups} new signups (prev ${ow.previousWeek.newSignups}) · ${ow.thisWeek.activeAccounts} active · ${ow.thisWeek.requests} requests (prev ${ow.previousWeek.requests}) · cost ${usd(ow.thisWeek.costUsd)} (prev ${usd(ow.previousWeek.costUsd)}) · saved ${usd(ow.thisWeek.savingsUsd)} (prev ${usd(ow.previousWeek.savingsUsd)})`,
  );
  console.log("");
  if (view === "orchestration") {
    if (report.orchestration.rows.length === 0) console.log("No orchestration accounts yet.");
    for (const r of report.orchestration.rows) {
      console.log(
        `${r.email ?? r.ownerId}${r.name ? ` (${r.name})` : ""} · ${r.kind} · signup ${r.signupAt?.slice(0, 10) ?? "—"} · last ${r.lastActivityAt?.slice(0, 16) ?? "—"} · ${r.requests} req (${r.failedRequests} failed) · ${r.modelCalls} calls · ${r.inputTokens}/${r.outputTokens} tok · p50 ${r.latencyP50Ms ?? "—"} ms p95 ${r.latencyP95Ms ?? "—"} ms · cost ${usd(r.costUsd)} · ref ${usd(r.referenceCostUsd)} · saved ${usd(r.savingsUsd)} (${r.savingsPct ?? "—"} %) · trial ${r.trial.capUsd === null ? "no cap" : `${usd(r.trial.spentUsd)} spent, ${usd(r.trial.remainingUsd ?? 0)} left${r.trial.reached ? ", REACHED" : ""}`}`,
      );
      if (r.useCase) console.log(`  use case: ${r.useCase.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  } else if (view === "library") {
    if (report.library.rows.length === 0) console.log("No library accounts yet.");
    for (const r of report.library.rows) {
      console.log(
        `${r.email ?? r.ownerId}${r.githubLogin ? ` @${r.githubLogin}` : ""} · ${
          Object.entries(r.channels)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ") || "—"
        } · first ${r.firstSeenAt?.slice(0, 10) ?? "—"} · last ${r.lastActivityAt?.slice(0, 16) ?? "—"} · ${r.flows} flows (${r.verified} verified, ${r.failed} failed, ${r.notCovered} not covered) · checks ${r.checksPassed}/${r.checksTotal} · requirements ${r.requirementsMet} met, ${r.requirementsOpen} open · ${r.downloads} downloads · ${r.pullRequests} PRs · ${r.deploys} deploys · AI ${usd(r.aiSpentUsd)}`,
      );
    }
  } else {
    if (report.people.length === 0) console.log("No accounts yet.");
    for (const p of report.people) {
      console.log(
        `${p.email ?? p.key}${p.name ? ` (${p.name})` : ""} · ${p.products.join(" + ")} · last ${p.lastActivityAt?.slice(0, 16) ?? "—"}${p.library ? ` · library ${p.library.flows} flows, ${p.library.verified} verified, ${p.library.notCovered} not covered [${p.library.channels.join(",")}]` : ""}${p.orchestration ? ` · orchestration ${p.orchestration.requests} req, cost ${usd(p.orchestration.costUsd)}, saved ${usd(p.orchestration.savingsUsd)}` : ""}`,
      );
    }
  }
}
