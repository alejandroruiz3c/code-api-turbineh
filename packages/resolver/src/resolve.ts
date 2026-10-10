import semver from "semver";

/** Licenses allowed for components assembled in the beta (PLAN §3.6). */
export const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

export interface Candidate {
  id: string;
  status: "discovered" | "evaluated" | "approved" | "deprecated";
  provides: string[];
  /** npm package name and exact version, from the manifest purl. */
  pkg: { name: string; version: string };
  license: { declared: string; detected: string };
  /** Peer ranges the component needs (e.g. { next: "^16.0.0" }). */
  peer: Record<string, string>;
  conflicts: string[];
  requires: string[];
}

/** Exact versions of the recipe's base stack (from its package.json). */
export type Stack = Record<string, string>;

export interface Rejection {
  id: string;
  rule: "status" | "license" | "license-mismatch" | "peer" | "conflict" | "missing-requirement";
  detail: string;
}

export interface Resolution {
  ok: boolean;
  selected: Record<string, Candidate>;
  rejected: Rejection[];
  /** Capabilities left without a compatible component (Backup Coder trigger T1). */
  gaps: string[];
}

/** Every rule a single component must pass on its own. Deterministic; never decided by a model. */
export function checkComponent(c: Candidate, stack: Stack): Rejection[] {
  const out: Rejection[] = [];
  if (c.status !== "approved")
    out.push({ id: c.id, rule: "status", detail: `status is ${c.status}` });
  if (c.license.declared !== c.license.detected) {
    out.push({
      id: c.id,
      rule: "license-mismatch",
      detail: `${c.license.declared} ≠ ${c.license.detected}`,
    });
  }
  if (!ALLOWED_LICENSES.has(c.license.detected)) {
    out.push({ id: c.id, rule: "license", detail: `${c.license.detected} not allowed` });
  }
  for (const [dep, range] of Object.entries(c.peer)) {
    const have = stack[dep];
    if (!have) continue; // peer not used by this stack (e.g. optional framework integrations)
    if (!semver.satisfies(have, range, { includePrerelease: false })) {
      out.push({ id: c.id, rule: "peer", detail: `${dep}@${have} does not satisfy ${range}` });
    }
  }
  return out;
}

/**
 * Resolves a compatible set: for each capability, take the ranked candidates (decider order) and keep the first
 * one that passes every rule and does not conflict with components already chosen.
 */
export function resolveSet(
  ranked: Record<string, Candidate[]>,
  stack: Stack,
  alreadySelected: Record<string, Candidate> = {},
): Resolution {
  const selected: Record<string, Candidate> = { ...alreadySelected };
  const rejected: Rejection[] = [];
  const gaps: string[] = [];

  for (const [capability, candidates] of Object.entries(ranked)) {
    if (selected[capability]) continue;
    let chosen: Candidate | undefined;
    for (const c of candidates) {
      const problems = checkComponent(c, stack);
      const chosenIds = new Set(Object.values(selected).map((s) => s.id));
      for (const other of Object.values(selected)) {
        if (c.conflicts.includes(other.id) || other.conflicts.includes(c.id)) {
          problems.push({ id: c.id, rule: "conflict", detail: `conflicts with ${other.id}` });
        }
      }
      // A component shared by several capabilities (e.g. one auth library) is selected once.
      if (
        problems.length === 0 ||
        (chosenIds.has(c.id) && problems.every((p) => p.rule === "conflict"))
      ) {
        chosen = c;
        break;
      }
      rejected.push(...problems);
    }
    if (chosen) selected[capability] = chosen;
    else gaps.push(capability);
  }

  const provided = new Set(Object.values(selected).flatMap((c) => c.provides));
  for (const c of new Set(Object.values(selected))) {
    for (const req of c.requires) {
      if (!provided.has(req)) {
        rejected.push({ id: c.id, rule: "missing-requirement", detail: `requires ${req}` });
      }
    }
  }
  const missing = rejected.some((r) => r.rule === "missing-requirement");
  return { ok: !missing, selected, rejected, gaps };
}
