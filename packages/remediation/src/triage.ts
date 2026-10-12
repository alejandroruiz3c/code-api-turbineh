import { choice, noul, type Decider } from "@turbineh/decider";
import type { StaticFinding, VerifyResult } from "@turbineh/verifier";

export type FixStrategy = "local" | "human";

const LOCAL = "Fix inside this file";
const HUMAN = "Needs a human decision";

/** Below this confidence a "needs a human" answer is ignored and the fix is attempted anyway. */
const HUMAN_THRESHOLD = 0.7;

const findingKey = (f: StaticFinding) => `${f.path}:${f.line}:${f.rule}`;

/**
 * One batched decider request per remediation round: one atomic Choice per static finding. Blocking findings (ERROR)
 * are always attempted — the model only routes work, it never waives a check; the verification decides afterwards.
 * Warnings that clearly need a product decision are not sent to the fixer (no wasted calls or rounds).
 */
export async function triageFindings(
  findings: StaticFinding[],
  decider: Decider | undefined,
): Promise<Map<string, FixStrategy>> {
  const out = new Map<string, FixStrategy>(findings.map((f) => [findingKey(f), "local"]));
  // Direct model calls are always rerouted through the orchestrator (owner decision, ADR-0029): never left to a person.
  const warnings = findings.filter((f) => f.severity === "WARNING" && !isAiReroute(f));
  if (!decider || warnings.length === 0) return out;
  const questions = Object.fromEntries(
    warnings.map((f, i) => [
      `f${i}`,
      choice(
        {
          file: f.path,
          problem: f.message,
          why_it_matters: f.explain,
          question: "How can this security finding be fixed?",
        },
        {
          [LOCAL]:
            "A small change in the same file: sanitize or validate the value, use the existing helper, remove the unsafe call.",
          [HUMAN]:
            "Fixing it changes what the product does for users or needs information that is not in the code.",
        },
        { includeNone: false },
      ),
    ]),
  );
  const d = await decider.ask({ app_kind: "Next.js web app" }, questions).catch(() => null);
  warnings.forEach((f, i) => {
    const a = d?.answers[`f${i}`];
    if (a?.type === "choice" && a.choice === HUMAN && a.confidence >= HUMAN_THRESHOLD) {
      out.set(findingKey(f), "human");
    }
  });
  return out;
}

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
 * code warnings use one Noul per alert in a single batched decider request.
 */
export async function estimateImprovement(
  v: VerifyResult,
  verifyMs: number,
  decider: Decider | undefined,
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
    const questions = Object.fromEntries(
      warnings.map((f, i) => [
        `w${i}`,
        noul({
          file: f.path,
          problem: f.message,
          why_it_matters: f.explain,
          question:
            "Can this be fixed with a small change in this file, without changing what the product does?",
        }),
      ]),
    );
    const d = await decider.ask({ app_kind: "Next.js web app" }, questions).catch(() => null);
    codeFixable = warnings.filter((_, i) => {
      const a = d?.answers[`w${i}`];
      return a?.type === "noul" && a.noul >= 0.6;
    }).length;
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
