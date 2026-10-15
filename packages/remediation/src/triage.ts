import type { Decider, FixStrategy } from "@turbineh/decider";
import type { StaticFinding, VerifyResult } from "@turbineh/verifier";

export type { FixStrategy };

const findingKey = (f: StaticFinding) => `${f.path}:${f.line}:${f.rule}`;

/**
 * Routes each static finding before a remediation round (resource decision engine, ADR-0058). Blocking findings
 * (ERROR) are always attempted — the engine only routes work, it never waives a check; the verification decides
 * afterwards. Warnings that clearly need a product decision are not sent to the fixer (no wasted calls or rounds).
 */
export async function triageFindings(
  findings: StaticFinding[],
  decider: Pick<Decider, "triageFindings"> | undefined,
): Promise<Map<string, FixStrategy>> {
  const out = new Map<string, FixStrategy>(findings.map((f) => [findingKey(f), "local"]));
  // Direct model calls are always rerouted through the orchestrator (owner decision, ADR-0029): never left to a person.
  const warnings = findings.filter((f) => f.severity === "WARNING" && !isAiReroute(f));
  if (!decider || warnings.length === 0) return out;
  const routes = await decider.triageFindings(warnings.map(findingInput)).catch(() => null);
  warnings.forEach((f, i) => {
    if (routes?.[i] === "human") out.set(findingKey(f), "human");
  });
  return out;
}

const findingInput = (f: StaticFinding) => ({
  path: f.path,
  message: f.message,
  explain: f.explain,
});

export { findingKey };

/** What the user gets by asking "Improve & redeliver" — shown before they decide. */
export interface ImprovementEstimate {
  /** Remaining alerts that the improvement would try to fix. */
  total: number;
  /** Alerts that can most likely be fixed automatically. */
  fixable: number;
  /** Fixable alerts that affect what is shipped to users (production). */
  fixableProduction: number;
  /** Estimated duration in minutes (range) from this build's own measured verification time. */
  minutes: { min: number; max: number };
  /** Every improvement counts as one build of the daily quota and can be requested once. */
  usesOneBuild: true;
}

/**
 * Estimates the improvement. Dependency alerts are fixable when a patched version exists (deterministic, OSV);
 * code warnings are judged by the resource decision engine (none counts as fixable without an answer).
 */
export async function estimateImprovement(
  v: VerifyResult,
  verifyMs: number,
  decider: Pick<Decider, "fixableFindings"> | undefined,
  hasPatchedVersion: (id: string, pkg: string) => Promise<boolean>,
): Promise<ImprovementEstimate | null> {
  const warnings = v.findings.static.filter((f) => f.severity === "WARNING");
  const advisories = v.findings.advisories;
  const total = warnings.length + advisories.length;
  if (total === 0) return null;

  const patched = await Promise.all(
    advisories.map((a) => hasPatchedVersion(a.id, a.pkg).catch(() => false)),
  );
  let codeFixable = 0;
  if (warnings.length > 0 && decider) {
    const fixable = await decider.fixableFindings(warnings.map(findingInput)).catch(() => null);
    codeFixable = warnings.filter((_, i) => fixable?.[i] === true).length;
  }
  const depFixable = patched.filter(Boolean).length;
  const fixableProduction =
    advisories.filter((a, i) => patched[i] && a.scope === "production").length + codeFixable;
  const fixable = depFixable + codeFixable;
  // One restore + fix pass, then full verifications: at least one, up to the 3 rounds allowed for an improvement.
  const verifyMin = Math.max(verifyMs, 1000);
  const minMs = 60_000 + verifyMin * (codeFixable > 0 ? 2 : 1);
  const maxMs = 60_000 + verifyMin * 4;
  return {
    total,
    fixable,
    fixableProduction,
    minutes: {
      min: Math.max(1, Math.round(minMs / 60_000)),
      max: Math.max(2, Math.ceil(maxMs / 60_000)),
    },
    usesOneBuild: true,
  };
}

/** Findings that are fixed by rerouting the call through the TurbineH orchestrator. */
export const isAiReroute = (f: { rule: string }) => f.rule === "turbineh.ai-direct-model-call";
