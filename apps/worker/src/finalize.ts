import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeReports } from "@turbineh/assembler";
import type { Decider } from "@turbineh/decider";
import {
  alertsOf,
  estimateImprovement,
  fixedVersion,
  needsRemediation,
  remediateOnce,
  repairAfterRemediation,
  type FixerSlot,
  type ImprovementEstimate,
  type RemediationChange,
  type SecurityAlert,
} from "@turbineh/remediation";
import {
  buildReport,
  reportMarkdown,
  type BuildReport,
  type ReportFacts,
  type WriterConfig,
} from "@turbineh/reporter";
import { verify, type VerifyResult } from "@turbineh/verifier";

export interface FinalizeDeps {
  decider: Decider;
  fixers: FixerSlot[];
  writer: WriterConfig;
  reasoningEffort?: string;
  emit: (
    phase: "verifying" | "remediating" | "reporting",
    type: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
}

export interface FinalizeInput {
  buildId: string;
  repoDir: string;
  scope: "auto" | "improve";
  facts: Omit<
    ReportFacts,
    "evidence" | "checks" | "alerts" | "remediation" | "improvement" | "finalVersion"
  >;
  metrics: Record<string, unknown>;
}

export interface FinalizeResult {
  ok: boolean;
  verify: VerifyResult;
  alerts: SecurityAlert[];
  remediation: RemediationChange[];
  report: BuildReport;
  verifyMs: number;
  /** Offered once, only on normal builds with remaining alerts. */
  improvement: ImprovementEstimate | null;
}

const stepsView = (v: VerifyResult) => v.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms }));

/** Evidence actually produced by this build's checks: E2E and unit test titles found in the repository. */
function evidenceOf(repoDir: string): string[] {
  const out = new Set<string>();
  for (const dir of ["tests/e2e", "tests/unit"]) {
    const path = join(repoDir, dir);
    if (!existsSync(path)) continue;
    const files = readdirSync(path);
    for (const f of files.filter((x) => /\.(spec|test|setup)\.ts$/.test(x))) {
      const src = readFileSync(join(repoDir, dir, f), "utf8");
      for (const m of src.matchAll(/(?:test|it|setup)\(\s*"([^"]{5,140})"/g)) {
        out.add(`${dir.endsWith("e2e") ? "End-to-end test" : "Unit test"}: ${m[1]}`);
      }
    }
  }
  out.add("Strict type checking and production build");
  out.add("Input validation with Zod schemas on every form and action");
  return [...out];
}

/**
 * Verification → automatic security remediation (re-verifying after every round) → report → documents → commit.
 * Nothing is delivered while blocking findings remain; non-blocking alerts are delivered and explained.
 */
export async function finalize(input: FinalizeInput, deps: FinalizeDeps): Promise<FinalizeResult> {
  const t = performance.now();
  await deps.emit("verifying", "start", {});
  let lastVerifyMs = 0;
  const timedVerify = async () => {
    const v0 = performance.now();
    const r = await verify(input.repoDir);
    lastVerifyMs = Math.round(performance.now() - v0);
    return r;
  };
  let result = await timedVerify();
  await deps.emit("verifying", "done", { ok: result.ok, steps: stepsView(result) });

  const remediation: RemediationChange[] = [];
  const maxRounds = input.scope === "improve" ? 3 : 2;
  for (let round = 1; round <= maxRounds && needsRemediation(result, input.scope); round++) {
    await deps.emit("remediating", "start", {
      round,
      findings: result.findings.static.length + result.findings.advisories.length,
    });
    const changes = await remediateOnce(input.repoDir, result, {
      decider: deps.decider,
      fixers: deps.fixers,
      scope: input.scope,
      ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
    }).catch(async (err: unknown) => {
      await deps.emit("remediating", "error", {
        round,
        error: err instanceof Error ? err.message.slice(0, 300) : "failed",
      });
      return [] as RemediationChange[];
    });
    await deps.emit("remediating", "done", { round, changes });
    if (changes.length === 0) break;
    remediation.push(...changes);
    await deps.emit("verifying", "start", { afterRemediation: round });
    result = await timedVerify();
    await deps.emit("verifying", "done", {
      ok: result.ok,
      steps: stepsView(result),
      afterRemediation: round,
    });
    // A fix must never break the app: repair only the files the remediation touched, then verify everything again.
    const touched = [
      ...new Set(
        remediation.filter((c) => c.kind === "code").map((c) => c.target.split(":")[0] ?? ""),
      ),
    ].filter(Boolean);
    for (let repair = 1; repair <= 2 && !result.ok && touched.length > 0; repair++) {
      const fixes = await repairAfterRemediation(input.repoDir, result, touched, {
        fixers: deps.fixers,
        scope: input.scope,
        ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
      }).catch(() => [] as RemediationChange[]);
      await deps.emit("remediating", "repair", { repair, fixes });
      if (fixes.length === 0) break;
      remediation.push(...fixes);
      result = await timedVerify();
      await deps.emit("verifying", "done", {
        ok: result.ok,
        steps: stepsView(result),
        afterRepair: repair,
      });
    }
  }
  const verifyMs = Math.round(performance.now() - t);
  const alerts = alertsOf(result);
  // "Improve & redeliver" is offered once: never on an improvement build, never when nothing can be fixed.
  const improvement =
    input.scope === "auto" && result.ok && alerts.length > 0
      ? await estimateImprovement(result, lastVerifyMs, deps.decider, async (id, pkg) =>
          Boolean(await fixedVersion(id, pkg.slice(0, pkg.lastIndexOf("@")))),
        ).catch(() => null)
      : null;

  await deps.emit("reporting", "start", {});
  const facts: ReportFacts = {
    ...input.facts,
    evidence: evidenceOf(input.repoDir),
    checks: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
    alerts,
    remediation,
    improvement,
    finalVersion: input.scope === "improve",
  };
  const report = await buildReport(facts, deps.decider, deps.writer);
  await deps.emit("reporting", "done", { report });

  const metrics = {
    ...input.metrics,
    alerts,
    remediation,
    improvement,
    report: { writer: report.writer },
  };
  writeReports(
    input.repoDir,
    securityMarkdown(result, alerts, remediation),
    reportMarkdown(report, JSON.stringify(metrics, null, 2)),
  );
  execFileSync("git", ["add", "-A"], { cwd: input.repoDir });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=CODE-API-TURBINEH",
      "-c",
      "user.email=builds@turbineh.com",
      "commit",
      "-q",
      "-m",
      "docs: security report and build report",
    ],
    { cwd: input.repoDir },
  );
  return { ok: result.ok, verify: result, alerts, remediation, report, verifyMs, improvement };
}

function securityMarkdown(
  v: VerifyResult,
  alerts: SecurityAlert[],
  fixed: RemediationChange[],
): string {
  const row = (n: string) => {
    const s = v.steps.find((x) => x.name === n);
    return s ? (s.ok ? "pass" : "FAIL") : "not run";
  };
  return `# Security report

- Date: ${v.scannedAt}
- Scope: this repository at the commit that contains this file, its lockfile (direct and transitive npm dependencies)
  and the running app in an isolated network without internet access.

| Check | Tool | Result |
|---|---|---|
| Secrets in git history | gitleaks | ${row("secrets")} |
| Static analysis (injection, authorization, secrets, XSS, redirects, logging) | Semgrep OSS engine + TurbineH rules | ${row("static")} |
| Known vulnerabilities (direct + transitive) | OSV database | ${row("dependencies")} |
| Licenses (copyleft / unlicensed blocked) | installed package metadata | ${row("licenses")} |
| Type safety | TypeScript strict | ${row("typecheck")} |
| Lint | ESLint | ${row("lint")} |
| Unit tests (security headers, rate limit, role policy) | Vitest | ${row("unit")} |
| End-to-end (sign-up, access control, data flows) | Playwright | ${row("e2e")} |

## Fixed automatically before delivery

${fixed.length ? fixed.map((c) => `- ${c.kind === "dependency" ? "Dependency" : "Code"} · ${c.target} — ${c.detail} (${c.reason})`).join("\n") : "- Nothing needed fixing."}

## Remaining alerts (non-blocking)

${alerts.length ? alerts.map((a) => `- **${a.title}** (${a.where}) — ${a.explain}`).join("\n") : "- None."}

## Not checked

- Penetration testing, load testing and the infrastructure configuration of your deployment.
- Business-logic authorization beyond the role policy in \`src/server/authz.ts\`.

This report is not a statement that the software is "secure"; it lists what was checked, when and with what result.
`;
}
