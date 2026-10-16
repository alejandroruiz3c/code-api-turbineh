import { execFileSync } from "node:child_process";
import type { CheckStatus, VerifyResult } from "@turbineh/verifier";
import type { RemediationChange } from "./remediate.js";

/**
 * The security ledger (ADR-0065): what a remediation really fixed, decided by scans, never by the fixer's claim.
 *
 * - A finding is identified by rule + file + line (code) or advisory + package@version (dependency); duplicates are
 *   counted once.
 * - After every remediation round the full gate runs again; a finding counts as fixed only when it was attempted in
 *   that round and is gone from the new scan. Line numbers move when a file is edited, so code findings are compared
 *   per rule and file: if a file still has as many findings of a rule as before, none of them is fixed.
 * - At the end the candidates are reconciled with the final scan (after repairs): a finding still present — or a rule
 *   and file that did not lose findings overall — is never listed as fixed. Nothing is both "fixed" and "remaining".
 * - A scan that did not run (`staticScanned: false`) proves nothing: no code finding is counted as fixed from it.
 */
export interface FindingRef {
  kind: "code" | "dependency";
  /** Semgrep rule id or advisory id. */
  rule: string;
  /** "path:line" (code) or "name@version" (dependency). */
  where: string;
  /** File (code) or package name (dependency): the unit findings are compared in. */
  unit: string;
  /** ERROR / WARNING (code) or the advisory's severity. */
  severity: string;
}

export interface SecurityFix extends FindingRef {
  /** Remediation round that fixed it. */
  round: number;
  /** What was changed for it (the file, or the dependency pin). */
  change: string;
  /** Commit of that round in the delivered repository (`git show <commit>`). */
  commit: string | null;
}

export const refKey = (r: Pick<FindingRef, "rule" | "where">) => `${r.rule}|${r.where}`;
const groupKey = (r: Pick<FindingRef, "rule" | "unit">) => `${r.rule}|${r.unit}`;
const pkgName = (pkg: string) => pkg.slice(0, Math.max(pkg.lastIndexOf("@"), 0)) || pkg;

/** Every finding of a gate result, deduplicated by rule + file + line (or advisory + package). */
export function findingRefs(v: VerifyResult): FindingRef[] {
  const out = new Map<string, FindingRef>();
  for (const f of v.findings.static) {
    const r: FindingRef = {
      kind: "code",
      rule: f.rule,
      where: `${f.path}:${f.line}`,
      unit: f.path,
      severity: f.severity,
    };
    out.set(refKey(r), r);
  }
  for (const a of v.findings.advisories) {
    const r: FindingRef = {
      kind: "dependency",
      rule: a.id,
      where: a.pkg,
      unit: pkgName(a.pkg),
      severity: a.severity,
    };
    out.set(refKey(r), r);
  }
  return [...out.values()];
}

const countBy = (refs: FindingRef[]) => {
  const m = new Map<string, number>();
  for (const r of refs) m.set(groupKey(r), (m.get(groupKey(r)) ?? 0) + 1);
  return m;
};

/** True when the static scan of `v` ran (results recorded before the flag existed count as ran). */
const staticRan = (v: VerifyResult) => v.findings.staticScanned !== false;

/** Findings of `before` that one of `changes` addressed (code: same file and rule; dependency: same advisory). */
export function attempted(before: VerifyResult, changes: RemediationChange[]): FindingRef[] {
  const code = new Set(
    changes.filter((c) => c.kind === "code").map((c) => `${c.reason}|${c.target}`),
  );
  const deps = new Set(changes.filter((c) => c.kind === "dependency").map((c) => c.reason));
  return findingRefs(before).filter((r) =>
    r.kind === "code" ? code.has(`${r.rule}|${r.where}`) : deps.has(r.rule),
  );
}

/**
 * One remediation round, settled by the re-scan: the attempted findings that are gone (`fixed`) and the ones that are
 * still there (`notFixed`).
 */
export function settleRound(
  round: number,
  before: VerifyResult,
  after: VerifyResult,
  changes: RemediationChange[],
  commit: string | null,
): { fixed: SecurityFix[]; notFixed: FindingRef[] } {
  const tried = attempted(before, changes);
  const now = findingRefs(after);
  const nowKeys = new Set(now.map(refKey));
  const was = countBy(findingRefs(before));
  const left = countBy(now);
  const budget = new Map<string, number>();
  const fixed: SecurityFix[] = [];
  const notFixed: FindingRef[] = [];
  for (const r of tried) {
    const g = groupKey(r);
    if (!budget.has(g)) budget.set(g, Math.max(0, (was.get(g) ?? 0) - (left.get(g) ?? 0)));
    const gone =
      (r.kind === "dependency" || staticRan(after)) &&
      !nowKeys.has(refKey(r)) &&
      (budget.get(g) ?? 0) > 0;
    if (!gone) {
      notFixed.push(r);
      continue;
    }
    budget.set(g, (budget.get(g) ?? 0) - 1);
    const change =
      r.kind === "dependency"
        ? (changes.find((c) => c.kind === "dependency" && c.reason === r.rule)?.target ?? r.unit)
        : r.unit;
    fixed.push({ ...r, round, change, commit });
  }
  return { fixed, notFixed };
}

/**
 * Final reconciliation with the delivered scan: fixes are deduplicated, and a candidate is dropped when its finding is
 * still present or when its rule and file (package) did not lose findings between the first scan and the final one.
 */
export function reconcileFixes(
  candidates: SecurityFix[],
  baseline: VerifyResult,
  final: VerifyResult,
): SecurityFix[] {
  const finalRefs = findingRefs(final);
  const finalKeys = new Set(finalRefs.map(refKey));
  const was = countBy(findingRefs(baseline));
  const left = countBy(finalRefs);
  const budget = new Map<string, number>();
  const seen = new Set<string>();
  const out: SecurityFix[] = [];
  for (const c of candidates) {
    const k = refKey(c);
    if (seen.has(k) || finalKeys.has(k)) continue;
    if (c.kind === "code" && !staticRan(final)) continue;
    const g = groupKey(c);
    if (!budget.has(g)) budget.set(g, Math.max(0, (was.get(g) ?? 0) - (left.get(g) ?? 0)));
    if ((budget.get(g) ?? 0) <= 0) continue;
    budget.set(g, (budget.get(g) ?? 0) - 1);
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Attempted findings that are not fixed in the final scan (deduplicated), for "attempted, not fixed". */
export function notFixedFinally(tried: FindingRef[], fixed: SecurityFix[]): FindingRef[] {
  const done = new Set(fixed.map(refKey));
  const out = new Map<string, FindingRef>();
  for (const r of tried) if (!done.has(refKey(r))) out.set(refKey(r), r);
  return [...out.values()];
}

/** One correction applied before delivery, with its diff (ADR-0065). */
export interface CorrectionRecord {
  phase: "correction" | "backup-correction" | "swap" | "security-fix" | "repair";
  /** Attempt or round number within its phase. */
  round: number;
  /** Commit in the delivered repository (`git show <commit>` prints the full diff). */
  commit: string | null;
  files: string[];
  /** What it addressed: the failing checks or the findings. */
  why: string;
  /** Unified diff of the commit (bounded; `truncated` says so). */
  diff: string;
  truncated: boolean;
}

/** A change a repair tried to make and that was refused (tests, rules and check configuration are not targets). */
export interface RefusedChange {
  phase: CorrectionRecord["phase"];
  file: string;
  reason: string;
}

/** Everything the report and the page show about how the build was corrected (ADR-0065). */
export interface RemediationAudit {
  /** Each check of the first verification, with its status. */
  firstPass: { name: string; status: CheckStatus }[];
  /** Blocking findings and failing checks of the first verification ("rule at where"). */
  firstPassProblems: string[];
  corrections: CorrectionRecord[];
  refused: RefusedChange[];
  /** Findings fixed automatically, verified by a new scan and by the final one. */
  fixed: SecurityFix[];
  /** Findings a fix was attempted for that are still present. */
  notFixed: FindingRef[];
}

const MAX_DIFF_LINES = 150;

/** HEAD's commit, its files and its diff (bounded), or null when HEAD is not `since` (nothing was committed). */
export function commitRecord(
  dir: string,
  since: string | null,
  maxLines = MAX_DIFF_LINES,
): { commit: string; files: string[]; diff: string; truncated: boolean } | null {
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  let head: string;
  try {
    head = git(["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
  if (!head || head === since) return null;
  const range = since ? [`${since}..${head}`] : [head];
  const files = git(["diff", "--name-only", ...(since ? range : [`${head}~1`, head])])
    .split("\n")
    .filter(Boolean);
  const full = git(["diff", "--no-color", "--unified=2", ...(since ? range : [`${head}~1`, head])]);
  const lines = full.split("\n");
  const truncated = lines.length > maxLines;
  return {
    commit: head,
    files,
    diff: (truncated ? lines.slice(0, maxLines) : lines).join("\n").trimEnd(),
    truncated,
  };
}

export const headCommit = (dir: string): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
