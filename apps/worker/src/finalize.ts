import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  finalizeAcceptance,
  readAcceptanceJson,
  recordOwners,
  verifiedGuide,
  writeReports,
  writeStartHere,
  type HandoverFacts,
} from "@turbineh/assembler";
import type { BackupCoder } from "@turbineh/backup-coder";
import type { Decider } from "@turbineh/decider";
import {
  alertsOf,
  attempted,
  commitRecord,
  estimateImprovement,
  fixedVersion,
  headCommit,
  needsRemediation,
  notFixedFinally,
  reconcileFixes,
  remediateOnce,
  repairAfterRemediation,
  settleRound,
  type CorrectionRecord,
  type FindingRef,
  type FixerSlot,
  type ImprovementEstimate,
  type RefusedChange,
  type RemediationAudit,
  type RemediationChange,
  type SecurityAlert,
  type SecurityFix,
} from "@turbineh/remediation";
import {
  buildReport,
  reportMarkdown,
  type BuildReport,
  type ReportFacts,
  type WriterConfig,
} from "@turbineh/reporter";
import {
  attributeFailures,
  culpritsOf,
  backupPatch,
  failureLog,
  patchOnce,
  qualityFailed,
  type CorrectionStep,
  type FailureAttribution,
  type ModelCfg,
  type SwapPart,
} from "@turbineh/integrator";
import {
  advisoryBlocks,
  checkStatus,
  gateFailures,
  gateFindings,
  quickCheck,
  REPORTS_DIR,
  verify,
  type VerifyResult,
} from "@turbineh/verifier";
import { deliveryOf, notVerifiedMarkdown, type Delivery } from "./not-verified.js";

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
    "evidence" | "checks" | "alerts" | "remediation" | "improvement" | "finalVersion" | "audit"
  >;
  metrics: Record<string, unknown>;
  /**
   * Swap target: the commit before external integrations and Backup Coder fills. If directed corrections cannot make
   * the build green, only the parts the failure is attributed to (ADR-0037 §D2) are removed (their capabilities are
   * reported as gaps) and everything is verified again. Nothing unrelated to the failure is ever removed.
   */
  swap?: {
    toCommit: string;
    /**
     * Removable parts per capability (glue, Backup Coder module + test, T3 business rules + tests, integrated library
     * contract test). Removing restores each file as it was at `toCommit` (a rules stub) or deletes it.
     */
    parts: SwapPart[];
  };
}

export interface FinalizeResult {
  ok: boolean;
  verify: VerifyResult;
  alerts: SecurityAlert[];
  /** Every change the security remediation attempted (the fixer's claims; see `audit.fixed` for what is verified). */
  remediation: RemediationChange[];
  /**
   * How the build was corrected (ADR-0065): first-pass checks, every correction with its diff, refused changes, and
   * the security findings fixed — counted only when a new scan and the final one no longer find them.
   */
  audit: RemediationAudit;
  /** Non-blocking advisories delivered as accepted exceptions (ADR-0065), with their review date. */
  exceptions: AdvisoryException[];
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
  /** What is delivered and why (ADR-0037 §D1). */
  delivery: Delivery;
  /** Failure → owner → implicated parts, for every swap decision (ADR-0037 §D2). */
  attribution: { round: number; failures: FailureAttribution[]; removed: string[] }[];
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

/** Internal trigger ids (T1–T6) and model names never reach delivered files (ADR-0053). */
const INTERNAL_KEYS = new Set(["trigger", "model", "by", "slot"]);
function withoutInternals(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutInternals);
  if (typeof v !== "object" || v === null) return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !INTERNAL_KEYS.has(k))
      .map(([k, x]) => [k, withoutInternals(x)]),
  );
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
    ...(withoutInternals(rest) as Record<string, unknown>),
    tokens: t,
    decisions: {
      questions: d.questions,
      requests: d.requests,
      latencyMs: d.latencyMs,
      cached: d.cached,
    },
  };
}

const stepsView = (v: VerifyResult) =>
  v.steps.map((s) => ({
    name: s.name,
    ok: s.ok,
    ms: s.ms,
    ...(s.warnings ? { warnings: s.warnings } : {}),
  }));

/** A non-blocking advisory delivered as an accepted exception (ADR-0065): why, until when, and whether a fix exists. */
export interface AdvisoryException {
  id: string;
  pkg: string;
  severity: string;
  scope: "production" | "development";
  /** Patched version from OSV; null when none exists; undefined when the lookup failed. */
  patched?: string | null;
  reason: string;
  /** Date by which the exception must be reviewed again (scan date + EXCEPTION_REVIEW_DAYS). */
  reviewBy: string;
}

/** Accepted exceptions are reviewed again after this many days (SECURITY.md "Exceptions"). */
export const EXCEPTION_REVIEW_DAYS = 30;

/** Non-blocking advisories of the final scan as accepted exceptions, with an OSV lookup of a patched version. */
export async function advisoryExceptions(
  v: VerifyResult,
  patchedVersion: (id: string, name: string) => Promise<string | null>,
): Promise<AdvisoryException[]> {
  const reviewBy = new Date(Date.parse(v.scannedAt) + EXCEPTION_REVIEW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const open = v.findings.advisories.filter((a) => !advisoryBlocks(a));
  return Promise.all(
    open.map(async (a) => {
      const patched = await patchedVersion(a.id, a.pkg.slice(0, a.pkg.lastIndexOf("@"))).then(
        (x) => x,
        () => undefined,
      );
      const reason =
        a.scope === "development"
          ? "development-only (used to build or test the app; not shipped to users, not reachable at runtime)"
          : `${a.severity.toLowerCase()} severity in a shipped library (only high and critical block delivery)`;
      return {
        id: a.id,
        pkg: a.pkg,
        severity: a.severity,
        scope: a.scope,
        ...(patched === undefined ? {} : { patched }),
        reason,
        reviewBy,
      };
    }),
  );
}

/** "static: turbineh.unsanitized-html at src/app/x.tsx:60" — blocking findings and failing checks of a result. */
function problemsOf(v: VerifyResult): string[] {
  return gateFindings(v)
    .filter((f) => f.blocking)
    .map((f) => `${f.category === "quality" ? f.rule : `${f.rule} (${f.category})`} at ${f.where}`);
}

/**
 * Evidence actually produced by this build's checks: E2E and unit test titles found in the repository, with each
 * test's key assertions (expect lines) so a criterion is matched on what the test checks, not on its title alone.
 */
function evidenceOf(repoDir: string): { evidence: string[]; detail: Record<string, string[]> } {
  const out = new Set<string>();
  const detail: Record<string, string[]> = {};
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
      const starts = [...src.matchAll(/(?:test|it|setup)\(\s*"([^"]{5,200})"/g)];
      starts.forEach((m, i) => {
        const e = `${dir.endsWith("e2e") ? "End-to-end test" : "Unit test"}: ${m[1]}`;
        out.add(e);
        const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
        detail[e] = [
          ...(detail[e] ?? []),
          ...body
            .split("\n")
            .filter((l) => /expect\(|getByLabel\(/.test(l))
            .map((l) => l.trim().slice(0, 200)),
        ].slice(0, 12);
      });
    }
  }
  out.add("Strict type checking and production build");
  out.add("Input validation with Zod schemas on every form and action");
  return { evidence: [...out], detail };
}

/**
 * ADR-0035: a criterion is proven only by a test shipped in the package — the acceptance.yaml rules matched at assembly
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
    // Each gate step and the scans, live (ADR-0051): the flow page says which check is running.
    const r = await verify(input.repoDir, {
      onStep: (e) => void deps.emit("verifying", "step", { ...e }).catch(() => undefined),
    });
    lastVerifyMs = Math.round(performance.now() - v0);
    return r;
  };
  let result = await timedVerify();
  await deps.emit("verifying", "done", { ok: result.ok, steps: stepsView(result) });
  // The audit trail (ADR-0065): what failed on the first pass, every correction with its diff, refused changes.
  const audit: RemediationAudit = {
    firstPass: result.steps.map((s) => ({ name: s.name, status: checkStatus(s) })),
    firstPassProblems: problemsOf(result),
    corrections: [],
    refused: [],
    fixed: [],
    notFixed: [],
  };
  const refusedIn =
    (phase: RefusedChange["phase"]) =>
    (r: { file: string; reason: string }): void => {
      audit.refused.push({ phase, ...r });
    };
  const record = (
    phase: CorrectionRecord["phase"],
    round: number,
    since: string | null,
    why: string,
  ): CorrectionRecord | null => {
    const c = commitRecord(input.repoDir, since);
    if (!c) return null;
    const r: CorrectionRecord = { phase, round, why, ...c };
    audit.corrections.push(r);
    return r;
  };
  const failingChecks = (v: VerifyResult) =>
    v.steps
      .filter((s) => !s.ok)
      .map((s) => s.name)
      .join(", ") || "none";

  // WP10 corrector (PLAN §4: correcting ↺ max 3) → swap → Backup Coder (T4). Full verification after every step.
  const corrections: CorrectionStep[] = [];
  const swappedOut: string[] = [];
  const glueRemoved: string[] = [];
  const attribution: FinalizeResult["attribution"] = [];
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
      const since = headCommit(input.repoDir);
      const why = `failing: ${failingChecks(result)}`;
      const step = await patchOnce(
        input.repoDir,
        result,
        deps.correction.compiler,
        attempt,
        refusedIn("correction"),
      );
      await deps.emit("correcting", "done", { attempt, step });
      if (!step) break;
      record("correction", attempt, since, why);
      corrections.push(step);
      const quick = await quickCheck(input.repoDir);
      if (!quick.ok) {
        result = quick;
        full = false;
        continue;
      }
      await reverify({ afterCorrection: attempt });
    }
    // Swap (ADR-0037 §D2): each failure is attributed to the owner of the failing test file and of the files it
    // imports (.turbineh/owners.json). Only parts implicated by that evidence are removed — a glue helper is optional
    // (the library stays), a Backup Coder fill or an integrated library becomes a reported gap again. A failure in a
    // recipe or catalog component (e.g. a domain component's E2E) implicates no part: nothing is removed.
    const remaining = [...(input.swap?.parts ?? [])];
    for (let round = 1; qualityFailed(result) && remaining.length > 0; round++) {
      const failures = attributeFailures(
        input.repoDir,
        gateFailures(result),
        remaining,
        failureLog(result),
      );
      const culprits = culpritsOf(remaining, failures);
      attribution.push({ round, failures, removed: culprits.map((c) => c.capability) });
      await deps.emit("correcting", "attribution", {
        round,
        failures: failures.map((f) => ({
          step: f.step,
          test: f.test,
          where: f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null,
          owner: f.owner,
          implicated: f.implicated,
        })),
      });
      if (culprits.length === 0) break;
      const swapSince = headCommit(input.repoDir);
      const swapWhy = `failing: ${failingChecks(result)}; removed: ${culprits.map((c) => c.capability).join(", ")}`;
      for (const c of culprits) remaining.splice(remaining.indexOf(c), 1);
      const toCommit = input.swap?.toCommit ?? "HEAD";
      for (const p of culprits)
        for (const f of p.files) restoreOrRemove(input.repoDir, toCommit, f);
      // Dependencies changed only through integrated libraries: an install failure restores the assembled ones.
      if (
        failures.some((f) => f.step === "install") &&
        culprits.some((c) => c.kind === "integration")
      ) {
        for (const f of ["package.json", "pnpm-lock.yaml"])
          restoreOrRemove(input.repoDir, toCommit, f);
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
          `fix: remove ${culprits.length} generated part(s) the failing check is attributed to`,
        ],
        { cwd: input.repoDir },
      );
      glueRemoved.push(...culprits.filter((p) => p.kind === "glue").map((p) => p.capability));
      swappedOut.push(
        ...new Set(culprits.filter((p) => p.kind !== "glue").map((p) => p.capability)),
      );
      record("swap", round, swapSince, swapWhy);
      await deps.emit("correcting", "swap", { removed: culprits });
      await reverify({ afterSwap: round });
    }
    if (qualityFailed(result)) {
      await deps.emit("correcting", "start", { trigger: "T4" });
      const since = headCommit(input.repoDir);
      const why = `failing: ${failingChecks(result)}`;
      const step = await backupPatch(
        input.repoDir,
        result,
        deps.correction.backupCoder,
        input.buildId,
        corrections.length + 1,
        refusedIn("backup-correction"),
      );
      await deps.emit("correcting", "done", { trigger: "T4", step });
      if (step) {
        record("backup-correction", corrections.length + 1, since, why);
        corrections.push(step);
        await reverify({ afterCorrection: "T4" });
      }
    }
  }

  if (!full) await reverify({ afterCorrection: "final" });

  const remediation: RemediationChange[] = [];
  // Security ledger (ADR-0065): the scan before the first round is the baseline; every round is settled by a new scan.
  const baseline = result;
  const candidates: SecurityFix[] = [];
  const tried: FindingRef[] = [];
  const maxRounds = input.scope === "improve" ? 3 : 2;
  for (let round = 1; round <= maxRounds && needsRemediation(result, input.scope); round++) {
    await deps.emit("remediating", "start", {
      round,
      findings: result.findings.static.length + result.findings.advisories.length,
    });
    const before = result;
    const since = headCommit(input.repoDir);
    const changes = await remediateOnce(input.repoDir, result, {
      decider: deps.decider,
      fixers: deps.fixers,
      scope: input.scope,
      onRefused: refusedIn("security-fix"),
      ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
    }).catch(async (err: unknown) => {
      await deps.emit("remediating", "error", {
        round,
        error: err instanceof Error ? err.message.slice(0, 300) : "failed",
      });
      return [] as RemediationChange[];
    });
    if (changes.length === 0) {
      await deps.emit("remediating", "done", { round, changes, fixed: 0 });
      break;
    }
    remediation.push(...changes);
    tried.push(...attempted(before, changes));
    const fixRecord = record(
      "security-fix",
      round,
      since,
      `findings: ${[...new Set(changes.map((c) => `${c.reason} at ${c.target}`))].join("; ")}`,
    );
    await deps.emit("verifying", "start", { afterRemediation: round });
    result = await timedVerify();
    await deps.emit("verifying", "done", {
      ok: result.ok,
      steps: stepsView(result),
      afterRemediation: round,
    });
    // Counted as fixed only when the new scan no longer finds it (never on the fixer's claim).
    const settled = settleRound(round, before, result, changes, fixRecord?.commit ?? null);
    candidates.push(...settled.fixed);
    await deps.emit("remediating", "done", {
      round,
      changes,
      fixed: settled.fixed.length,
      notFixed: settled.notFixed.map((f) => `${f.rule} at ${f.where}`),
    });
    // A fix must never break the app: repair only the files the remediation touched, then verify everything again.
    const touched = [
      ...new Set(
        remediation.filter((c) => c.kind === "code").map((c) => c.target.split(":")[0] ?? ""),
      ),
    ].filter(Boolean);
    for (let repair = 1; repair <= 2 && !result.ok && touched.length > 0; repair++) {
      const repairSince = headCommit(input.repoDir);
      const repairWhy = `failing after the security fix: ${failingChecks(result)}`;
      const fixes = await repairAfterRemediation(input.repoDir, result, touched, {
        fixers: deps.fixers,
        scope: input.scope,
        onRefused: refusedIn("repair"),
        ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
      }).catch(() => [] as RemediationChange[]);
      await deps.emit("remediating", "repair", { repair, fixes });
      if (fixes.length === 0) break;
      record("repair", repair, repairSince, repairWhy);
      remediation.push(...fixes);
      result = await timedVerify();
      await deps.emit("verifying", "done", {
        ok: result.ok,
        steps: stepsView(result),
        afterRepair: repair,
      });
    }
  }
  // Final reconciliation: a finding still present in the delivered scan is never "fixed" (and fixes are deduplicated).
  audit.fixed = reconcileFixes(candidates, baseline, result);
  audit.notFixed = notFixedFinally(tried, audit.fixed);
  const verifyMs = Math.round(performance.now() - t);
  // What is delivered (ADR-0037 §D1): decided by code from the final gate result. Each failure is attributed to the
  // owner of its file and gets an exact place and a suggested fix.
  const keptParts = (input.swap?.parts ?? []).filter(
    (p) =>
      !swappedOut.includes(p.capability) &&
      !(p.kind === "glue" && glueRemoved.includes(p.capability)),
  );
  const delivery = deliveryOf(
    result,
    result.ok
      ? []
      : attributeFailures(input.repoDir, gateFailures(result), keptParts, failureLog(result)),
  );
  const alerts = alertsOf(result);
  const exceptions = await advisoryExceptions(result, fixedVersion);
  // "Improve & redeliver" is offered once: never on an improvement build, never when nothing can be fixed.
  const improvement =
    input.scope === "auto" && result.ok && alerts.length > 0
      ? await estimateImprovement(result, lastVerifyMs, deps.decider, async (id, pkg) =>
          Boolean(await fixedVersion(id, pkg.slice(0, pkg.lastIndexOf("@")))),
        ).catch(() => null)
      : null;

  await deps.emit("reporting", "start", {});
  const swapped = new Set(swappedOut);
  const produced = evidenceOf(input.repoDir);
  const facts: ReportFacts = {
    ...input.facts,
    components: input.facts.components.filter((c) => !swapped.has(c.capability)),
    gaps: [...new Set([...input.facts.gaps, ...swappedOut.filter((c) => !c.startsWith("rules."))])],
    backupGenerated: (input.facts.backupGenerated ?? []).filter((b) => !swapped.has(b.capability)),
    businessRules: (input.facts.businessRules ?? []).map((r) => ({
      ...r,
      implemented: !swapped.has(r.capability),
    })),
    evidence: produced.evidence,
    evidenceDetail: produced.detail,
    checks: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
    alerts,
    remediation,
    audit,
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
    checksWithWarnings: result.steps.filter((s) => checkStatus(s) === "warn").length,
    criteriaVerified: report.criteria.filter((c) => c.verified).length,
    criteriaTotal: report.criteria.length,
    alerts: alerts.length,
    // Verified by a new scan and by the final one (ADR-0065), never the number of changes the fixer made.
    fixedBeforeDelivery: audit.fixed.length,
  };
  // AGENTS.md + turbineh.json: the verified gate results and, per acceptance criterion, the passing test that proves
  // it or where to implement and prove it — so a coding agent knows at once what is left. ACCEPTANCE.md is rewritten
  // from the same result (ADR-0035); covered criteria become "met" only when the whole gate passed.
  const guide = verifiedGuide(input.repoDir, {
    gate: {
      ok: result.ok,
      verifiedAt: result.scannedAt,
      environment: "TurbineH sandbox: no internet, ephemeral Postgres, service mocks",
      steps: result.steps.map((s) => ({
        name: s.name,
        ok: s.ok,
        ms: s.ms,
        ...(s.warnings ? { warnings: s.warnings } : {}),
        ...(s.note ? { note: s.note } : {}),
      })),
      ...(result.skipped?.length ? { skipped: result.skipped } : {}),
      reports: shippedReports(input.repoDir),
      findings: gateFindings(result),
    },
    criteria: report.criteria,
    gaps: facts.gaps,
    failures: delivery.failures,
    backup: (facts.backupGenerated ?? []).map((b) => ({ capability: b.capability, file: b.file })),
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
    attribution,
    alerts,
    // What the fixer changed, and how many findings a new scan confirmed fixed (ADR-0065): never the same number.
    remediationAttempted: remediation,
    securityFixesVerified: audit.fixed.length,
    improvement,
    report: { writer: report.writer },
  };
  // Post-assembly parts that stayed are recorded as owners too (the package's map of who owns what).
  const kept = keptParts;
  if (kept.length > 0) {
    recordOwners(
      input.repoDir,
      Object.fromEntries(
        kept.flatMap((p) =>
          p.files
            .filter((f) => existsSync(join(input.repoDir, f)))
            .map((f) => [f, `${p.kind}:${p.capability}`]),
        ),
      ),
    );
  }
  writeStartHere(input.repoDir, handover);
  writeReports(
    input.repoDir,
    securityMarkdown(result, alerts, audit, exceptions),
    notVerifiedMarkdown(delivery) +
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
    audit,
    exceptions,
    report,
    verifyMs,
    improvement,
    corrections,
    swappedOut,
    glueRemoved,
    attribution,
    acceptance: metrics.acceptance,
    delivery,
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

export function securityMarkdown(
  v: VerifyResult,
  alerts: SecurityAlert[],
  audit: Pick<RemediationAudit, "fixed" | "notFixed" | "refused">,
  exceptions: AdvisoryException[],
): string {
  const row = (n: string) => {
    const s = v.steps.find((x) => x.name === n);
    if (!s) return "not run";
    const st = checkStatus(s);
    return st === "fail" ? "FAIL" : st === "warn" ? `pass with warnings (${s.warnings})` : "pass";
  };
  const fixed = audit.fixed.length
    ? audit.fixed
        .map(
          (f) =>
            `- ${f.kind === "dependency" ? "Dependency" : "Code"} · \`${f.rule}\` at \`${f.where}\` — fixed in round ${f.round}${f.commit ? ` (commit \`${f.commit.slice(0, 12)}\`)` : ""}: ${f.kind === "dependency" ? `pinned ${f.change}` : `changed \`${f.change}\``}`,
        )
        .join("\n")
    : "- Nothing was fixed automatically.";
  const notFixed = audit.notFixed.length
    ? `\n## Attempted, not fixed\n\nA fix was attempted, but the new scan still finds these. They are not counted as fixed.\n\n${audit.notFixed
        .map((f) => `- \`${f.rule}\` at \`${f.where}\` (${f.severity.toLowerCase()})`)
        .join("\n")}\n`
    : "";
  const refused = audit.refused.length
    ? `\n## Refused changes\n\nAutomatic repairs may not weaken tests, silence a check or edit its configuration. These proposed changes were reverted:\n\n${audit.refused
        .map((r) => `- \`${r.file}\` (${r.phase}): ${r.reason}`)
        .join("\n")}\n`
    : "";
  const exceptionList = exceptions.length
    ? exceptions
        .map(
          (e) =>
            `- **${e.id}** · ${e.severity.toLowerCase()} · \`${e.pkg}\` — ${e.reason}; patched version: ${e.patched === undefined ? "unknown (OSV lookup failed)" : (e.patched ?? "none published yet")}. Review by ${e.reviewBy}.`,
        )
        .join("\n")
    : "- None.";
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
in tracked files): it can block delivery but is not a vulnerability. Quality = the app's own checks. "Pass with
warnings" = nothing blocking, but non-blocking findings remain (listed below); it is never shown as a plain pass.
XSS and open redirects in routes, pages and components always block.
${policyFindings(v)}
## Fixed automatically before delivery

Counted only when a new scan after the fix, and the final scan, no longer find the finding (rule, file and line).

${fixed}
${notFixed}${refused}
## Remaining alerts (non-blocking)

${alerts.length ? alerts.map((a) => `- **${a.title}** (${a.where}) — ${a.explain}`).join("\n") : "- None."}

## Accepted exceptions

Known advisories that do not block delivery under TurbineH's policy (only high or critical advisories in shipped
libraries block): each one is listed with why it is accepted and the date it must be reviewed again.

${exceptionList}

## Not checked

- Penetration testing, load testing and the infrastructure configuration of your deployment.
- Business-logic authorization beyond the role policy in \`src/server/authz.ts\`.

This report is not a statement that the software is "secure"; it lists what was checked, when and with what result.
`;
}

/** Gate reports present in the package (`.turbineh/reports/`, ADR-0055). */
function shippedReports(repoDir: string): string[] {
  const dir = join(repoDir, REPORTS_DIR);
  return existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .map((f) => `${REPORTS_DIR}/${f}`)
    : [];
}
