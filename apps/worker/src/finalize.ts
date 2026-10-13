import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  finalizeAcceptance,
  readAcceptanceJson,
  verifiedGuide,
  writeReports,
  writeStartHere,
  type HandoverFacts,
} from "@turbineh/assembler";
import type { BackupCoder } from "@turbineh/backup-coder";
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
import {
  backupPatch,
  failureLog,
  patchOnce,
  qualityFailed,
  type CorrectionStep,
  type ModelCfg,
} from "@turbineh/integrator";
import { gateFindings, quickCheck, verify, type VerifyResult } from "@turbineh/verifier";

export interface FinalizeDeps {
  decider: Decider;
  fixers: FixerSlot[];
  writer: WriterConfig;
  reasoningEffort?: string;
  /** WP10 corrector: directed patches (compiler model), swap, then Backup Coder (T4). */
  correction?: { compiler: ModelCfg; backupCoder: BackupCoder };
  emit: (
    phase: "verifying" | "correcting" | "remediating" | "reporting",
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
  /**
   * Swap target: the commit before external integrations and Backup Coder fills. If directed corrections cannot make
   * the build green, the extras are removed (their capabilities are reported as gaps) and everything is verified again.
   */
  swap?: {
    toCommit: string;
    capabilities: string[];
    /**
     * Optional files per capability (glue, Backup Coder module + test, T3 business rules + tests), removable one by
     * one before a full swap. Removing restores the file as it was at `toCommit` (a rules stub) or deletes it.
     */
    parts: { capability: string; kind: "glue" | "backup" | "rules"; files: string[] }[];
  };
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
  corrections: CorrectionStep[];
  /** Facts behind START_HERE.html (kept so "Deploy for me" can regenerate it). */
  handover: HandoverFacts;
  /** Integrated components whose optional glue helper was removed (library and contract test kept). */
  glueRemoved: string[];
  /** Acceptance criteria → tests after the gate (ADR-0033). */
  acceptance: { met: number; covered: number; open: string[] };
  /** Capabilities whose integration or Backup Coder fill was removed because it could not be made green. */
  swappedOut: string[];
}

/** A file as it was at `commit` when it existed there (e.g. the business-rules stub), otherwise removed. */
function restoreOrRemove(dir: string, commit: string, file: string): void {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}:${file}`], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["checkout", "-q", commit, "--", file], { cwd: dir });
  } catch {
    rmSync(join(dir, file), { force: true });
  }
}

/**
 * Metrics shown in the delivered report: decisions are TurbineH orchestration, so no decider model or backend names
 * (PLAN §16 P8). The internal record keeps them.
 */
export function publicMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  const { decider, tokens, ...rest } = metrics;
  const d = (decider ?? {}) as Record<string, unknown>;
  const t = { ...((tokens ?? {}) as Record<string, unknown>) };
  delete t.decider;
  return {
    ...rest,
    tokens: t,
    decisions: {
      questions: d.questions,
      requests: d.requests,
      latencyMs: d.latencyMs,
      cached: d.cached,
    },
  };
}

const stepsView = (v: VerifyResult) => v.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms }));

/** Evidence actually produced by this build's checks: E2E and unit test titles found in the repository. */
function evidenceOf(repoDir: string): string[] {
  const out = new Set<string>();
  for (const dir of [
    "tests/e2e",
    "tests/unit",
    "tests/unit/components",
    "tests/unit/backup",
    "tests/unit/rules",
  ]) {
    const path = join(repoDir, dir);
    if (!existsSync(path)) continue;
    const files = readdirSync(path);
    for (const f of files.filter((x) => /\.(spec|test|setup)\.ts$/.test(x))) {
      const src = readFileSync(join(repoDir, dir, f), "utf8");
      for (const m of src.matchAll(/(?:test|it|setup)\(\s*"([^"]{5,200})"/g)) {
        out.add(`${dir.endsWith("e2e") ? "End-to-end test" : "Unit test"}: ${m[1]}`);
      }
    }
  }
  out.add("Strict type checking and production build");
  out.add("Input validation with Zod schemas on every form and action");
  return [...out];
}

/**
 * ADR-0034: a criterion is proven only by a test shipped in the package — the acceptance.yaml rules matched at assembly
 * first (deterministic), then the report's mapping when it points at a test. Anything else (e.g. "strict type
 * checking") is not a proof: the criterion stays open, with where to implement and prove it.
 */
export function provenOnlyByTests<
  R extends {
    criteria: { criterion: string; evidence: string; verified: boolean; confidence: number }[];
  },
>(repoDir: string, report: R, evidence: string[]): R {
  const ruled = new Map(
    readAcceptanceJson(repoDir).flatMap((a) => {
      const proof = a.tests
        .map((t) => {
          const [file = "", title = ""] = t.split(" › ");
          return `${file.startsWith("tests/e2e") ? "End-to-end test" : "Unit test"}: ${title}`;
        })
        .find((e) => evidence.includes(e));
      return proof ? [[a.criterion, proof] as const] : [];
    }),
  );
  const isTest = (e: string) => /^(End-to-end|Unit) test: /.test(e) && evidence.includes(e);
  return {
    ...report,
    criteria: report.criteria.map((c) => {
      const proof = ruled.get(c.criterion);
      if (proof) return { ...c, evidence: proof, verified: true, confidence: 1 };
      return c.verified && !isTest(c.evidence)
        ? { ...c, evidence: "Not verified automatically", verified: false }
        : c;
    }),
  };
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

  // WP10 corrector (PLAN §4: correcting ↺ max 3) → swap → Backup Coder (T4). Full verification after every step.
  const corrections: CorrectionStep[] = [];
  let swappedOut: string[] = [];
  let glueRemoved: string[] = [];
  // False while `result` comes from a quick check; every exit from the correction phase is a full verification.
  let full = true;
  const reverify = async (data: Record<string, unknown>) => {
    full = true;
    result = await timedVerify();
    await deps.emit("verifying", "done", { ok: result.ok, steps: stepsView(result), ...data });
  };
  if (deps.correction && qualityFailed(result)) {
    // Inner loop: patch → quick check (lint, typecheck, unit; seconds). A full verification runs only when the
    // quick check is green, so build/E2E failures are still caught and nothing is accepted without it.
    for (let attempt = 1; attempt <= 3 && qualityFailed(result); attempt++) {
      await deps.emit("correcting", "start", { attempt });
      const step = await patchOnce(input.repoDir, result, deps.correction.compiler, attempt);
      await deps.emit("correcting", "done", { attempt, step });
      if (!step) break;
      corrections.push(step);
      const quick = await quickCheck(input.repoDir);
      if (!quick.ok) {
        result = quick;
        full = false;
        continue;
      }
      await reverify({ afterCorrection: attempt });
    }
    // Granular swap first: drop only the optional files named in the failing log (a glue helper is optional — the
    // library and its contract test stay; a Backup Coder fill becomes a reported gap again).
    const remaining = [...(input.swap?.parts ?? [])];
    while (qualityFailed(result) && remaining.length > 0) {
      const log = failureLog(result);
      let culprits = remaining.filter((p) => p.files.some((f) => log.includes(f)));
      // Business rules change behaviour (an E2E test can fail without naming them): they go before a full swap.
      if (culprits.length === 0) culprits = remaining.filter((p) => p.kind === "rules");
      if (culprits.length === 0) break;
      for (const c of culprits) remaining.splice(remaining.indexOf(c), 1);
      {
        for (const p of culprits) {
          for (const f of p.files)
            restoreOrRemove(input.repoDir, input.swap?.toCommit ?? "HEAD", f);
        }
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
            `fix: remove ${culprits.length} optional generated part(s) that could not be made green`,
          ],
          { cwd: input.repoDir },
        );
        glueRemoved.push(...culprits.filter((p) => p.kind === "glue").map((p) => p.capability));
        swappedOut.push(...culprits.filter((p) => p.kind !== "glue").map((p) => p.capability));
        await deps.emit("correcting", "swap", { removed: culprits });
        await reverify({ afterSwap: "partial" });
      }
    }
    if (qualityFailed(result) && input.swap && input.swap.capabilities.length > 0) {
      execFileSync("git", ["reset", "-q", "--hard", input.swap.toCommit], { cwd: input.repoDir });
      execFileSync("git", ["clean", "-qfd"], { cwd: input.repoDir });
      swappedOut = input.swap.capabilities;
      glueRemoved = [];
      await deps.emit("correcting", "swap", { removed: swappedOut });
      await reverify({ afterSwap: true });
    }
    if (qualityFailed(result)) {
      await deps.emit("correcting", "start", { trigger: "T4" });
      const step = await backupPatch(
        input.repoDir,
        result,
        deps.correction.backupCoder,
        input.buildId,
        corrections.length + 1,
      );
      await deps.emit("correcting", "done", { trigger: "T4", step });
      if (step) {
        corrections.push(step);
        await reverify({ afterCorrection: "T4" });
      }
    }
  }

  if (!full) await reverify({ afterCorrection: "final" });

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
  const swapped = new Set(swappedOut);
  const facts: ReportFacts = {
    ...input.facts,
    components: input.facts.components.filter((c) => !swapped.has(c.capability)),
    gaps: [...new Set([...input.facts.gaps, ...swappedOut.filter((c) => !c.startsWith("rules."))])],
    backupGenerated: (input.facts.backupGenerated ?? []).filter((b) => !swapped.has(b.capability)),
    businessRules: (input.facts.businessRules ?? []).map((r) => ({
      ...r,
      implemented: !swapped.has(r.capability),
    })),
    evidence: evidenceOf(input.repoDir),
    checks: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
    alerts,
    remediation,
    improvement,
    finalVersion: input.scope === "improve",
  };
  const report = provenOnlyByTests(
    input.repoDir,
    await buildReport(facts, deps.decider, deps.writer),
    facts.evidence,
  );
  await deps.emit("reporting", "done", { report });

  const handover = {
    appName: input.facts.appName,
    summary: input.facts.summary,
    verified: result.ok,
    checksPassed: result.steps.filter((s) => s.ok).length,
    checksTotal: result.steps.length,
    criteriaVerified: report.criteria.filter((c) => c.verified).length,
    criteriaTotal: report.criteria.length,
    alerts: alerts.length,
    fixedBeforeDelivery: remediation.filter((r) => r.reason !== "repair").length,
  };
  // AGENTS.md + turbineh.json: the verified gate results and, per acceptance criterion, the passing test that proves
  // it or where to implement and prove it — so a coding agent knows at once what is left. ACCEPTANCE.md is rewritten
  // from the same result (ADR-0034); covered criteria become "met" only when the whole gate passed.
  const guide = verifiedGuide(input.repoDir, {
    gate: {
      ok: result.ok,
      verifiedAt: result.scannedAt,
      environment: "TurbineH sandbox: no internet, ephemeral Postgres, service mocks",
      steps: result.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms })),
      findings: gateFindings(result),
    },
    criteria: report.criteria,
    gaps: facts.gaps,
  });
  const acceptance = guide
    ? guide.criteria.map((c) => ({
        criterion: c.text,
        status: c.status === "unverified" ? ("covered" as const) : c.status,
      }))
    : finalizeAcceptance(input.repoDir, result.ok);
  const metrics = {
    ...input.metrics,
    acceptance: {
      met: acceptance.filter((a) => a.status === "met").length,
      covered: acceptance.filter((a) => a.status === "covered").length,
      open: acceptance.filter((a) => a.status === "open").map((a) => a.criterion),
    },
    corrections,
    swappedOut,
    glueRemoved,
    alerts,
    remediation,
    improvement,
    report: { writer: report.writer },
  };
  writeStartHere(input.repoDir, handover);
  writeReports(
    input.repoDir,
    securityMarkdown(result, alerts, remediation),
    reportMarkdown(report, JSON.stringify(publicMetrics(metrics), null, 2)),
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
  return {
    ok: result.ok,
    handover,
    verify: result,
    alerts,
    remediation,
    report,
    verifyMs,
    improvement,
    corrections,
    swappedOut,
    glueRemoved,
    acceptance: metrics.acceptance,
  };
}

function policyFindings(v: VerifyResult): string {
  const policy = gateFindings(v).filter((f) => f.category === "policy");
  if (policy.length === 0) return "";
  const lines = policy.map(
    (f) =>
      `- ${f.blocking ? "blocking" : "non-blocking"} \`${f.rule}\` at \`${f.where}\`: ${f.message}`,
  );
  return `\n## Policy findings\n\n${lines.join("\n")}\n`;
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

| Check | Kind | Tool | Result |
|---|---|---|---|
| Secrets in git history | security | gitleaks | ${row("secrets")} |
| Static analysis (injection, authorization, secrets, XSS, redirects, logging) | security | Semgrep OSS engine + TurbineH rules | ${row("static")} |
| Known vulnerabilities (direct + transitive) | security | OSV database | ${row("dependencies")} |
| Licences (copyleft / unlicensed blocked) | policy | installed package metadata | ${row("licenses")} |
| Type safety | quality | TypeScript strict | ${row("typecheck")} |
| Lint | quality | ESLint | ${row("lint")} |
| Unit tests (security headers, rate limit, role policy) | quality | Vitest | ${row("unit")} |
| End-to-end (sign-up, access control, data flows) | quality | Playwright | ${row("e2e")} |

Security = a weakness an attacker could use. Policy = TurbineH delivery policy (licence list, no secret-shaped literals
in tracked files): it can block delivery but is not a vulnerability. Quality = the app's own checks.
${policyFindings(v)}
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
