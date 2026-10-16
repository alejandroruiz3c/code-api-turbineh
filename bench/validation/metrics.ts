/**
 * Go-validation benchmark (audit report v2, section 9): pure scoring of the raw runs written by run.ts. No network, no
 * model: every number in RESULTS.md comes from these functions over runs/<run>/*.json, the labels in statements.json
 * and a person's confirmations in runs/<run>/review.json.
 */

export type Band = "A" | "B" | "C";
export type Expected = "build" | "partial_or_offer" | "refuse_or_offer";

export interface CanonicalRequirement {
  id: string;
  text: string;
  /** Case-insensitive regular expressions; all must match one compiled criterion. */
  match: string[];
  /** Band B: a capability the use case does not include (expected to be removed explicitly or offered apart). */
  new?: boolean;
}
export interface GapLabel {
  text: string;
  match: string[];
  knownToGate: boolean;
}
export interface Statement {
  id: string;
  band: Band;
  recipe: string | null;
  expected: Expected;
  prompt: string;
  requirements?: CanonicalRequirement[];
  gaps: GapLabel[];
}

/** What run.ts stores per statement (raw API answers, trimmed to the fields scored here). */
export interface StatementRun {
  id: string;
  band: Band;
  env: string;
  api: string;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  phase: "done" | "error";
  error: string | null;
  flowId: string | null;
  plan: {
    httpStatus: number;
    /** The problem body when POST /v1/plans refused (422) or failed. */
    problem: Record<string, unknown> | null;
    body: Record<string, unknown> | null;
    ms: number;
  } | null;
  approved: string[] | null;
  generate: { httpStatus: number; body: Record<string, unknown> | null } | null;
  /** GET /v1/plans/{id} at the end (plan + result). */
  final: Record<string, unknown> | null;
  /** GET /v1/builds/{id} at the end (status, verified, delivery, metrics). */
  build: Record<string, unknown> | null;
  /** manifest.json of the package (GET /v1/plans/{id}/package?format=manifest). */
  manifest: Record<string, unknown> | null;
  /** turbineh.json of the delivered app (from GET /v1/plans/{id}/package?format=app). */
  guide: Record<string, unknown> | null;
  timings: { planMs: number | null; generateMs: number | null; wallMs: number };
}

export interface Review {
  /** statementId → requirementId → confirmed status (overrides the automatic mapping). */
  requirements?: Record<string, Record<string, ReqStatus>>;
  /** statementId → senior developer score 1–5 ("would you put it in production after configuring it?"). */
  expert?: Record<string, number>;
  /** statementId → contradictions dismissed by a person (exact strings from the report), with the reason. */
  dismissedContradictions?: Record<string, { text: string; why: string }[]>;
}

export type ReqStatus = "met" | "open" | "removed" | "missing";
export type Observed = "built" | "partial" | "offer" | "refused" | "error";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const matchesAll = (patterns: string[], text: string): boolean =>
  patterns.every((p) => new RegExp(p, "i").test(text));

/** The plan as the flow ended (GET /v1/plans/{id} has the plan's fields at the top level), else the POST answer. */
export function planOf(r: StatementRun): Obj {
  const fromFinal = obj(r.final?.plan);
  return Object.keys(fromFinal).length ? fromFinal : obj(r.plan?.body);
}
const resultOf = (r: StatementRun): Obj => obj(r.final?.result);
const problemOf = (r: StatementRun): Obj => obj(r.plan?.problem);

export function observedOutcome(r: StatementRun): Observed {
  if (r.phase === "error" && !r.plan?.problem && !r.plan?.body) return "error";
  const p = problemOf(r);
  if (str(p.code) === "use_case_not_covered")
    return obj(obj(p.explanation).offer).kind ? "offer" : "refused";
  if (r.plan?.problem) return "error";
  const scope = obj(planOf(r).scope);
  if (str(scope.status) === "components_only") return "offer";
  if (str(scope.status) === "partial") return "partial";
  return r.flowId ? "built" : "error";
}

/** Every place a requirement can be declared "not covered" before generating, as text. */
export function warningTexts(r: StatementRun): string[] {
  const p = problemOf(r);
  const scope = obj(planOf(r).scope);
  const ex = obj(Object.keys(obj(p.explanation)).length ? p.explanation : scope.explanation);
  const offer = obj(ex.offer);
  const reqText = (x: unknown) => `${str(obj(x).requirement)} — ${str(obj(x).why)}`;
  return [
    ...arr(p.notCovered).map(str),
    ...arr(scope.removed).map(reqText),
    ...arr(ex.notCovered).map(reqText),
    ...arr(offer.outOfScope).map(reqText),
    str(offer.notIncluded),
  ].filter(Boolean);
}

export function warnedBeforeGenerating(r: StatementRun): boolean {
  const o = observedOutcome(r);
  return o === "refused" || o === "offer" || (o === "partial" && warningTexts(r).length > 0);
}

/** Labelled gaps (B: new capabilities, C: the core) found in the warnings. */
export function gapsWarned(s: Statement, r: StatementRun): { gap: string; warned: boolean }[] {
  const texts = warningTexts(r);
  return s.gaps.map((g) => ({ gap: g.text, warned: texts.some((t) => matchesAll(g.match, t)) }));
}

export function outcomeOk(s: Statement, r: StatementRun): boolean {
  const o = observedOutcome(r);
  if (s.expected === "build") return o === "built";
  if (s.expected === "partial_or_offer")
    return (o === "partial" || o === "offer") && gapsWarned(s, r).every((g) => g.warned);
  return o === "refused" || o === "offer";
}

export interface Criterion {
  text: string;
  status: "met" | "open" | "covered" | "unverified";
  source: "turbineh.json" | "plan";
}

/** The request's compiled criteria and their final status: turbineh.json when delivered, else the plan's. */
export function derivedCriteria(r: StatementRun): Criterion[] {
  const g = arr(obj(r.guide).criteria);
  if (g.length)
    return g.map((c) => ({
      text: str(obj(c).text),
      status: (str(obj(c).status) || "open") as Criterion["status"],
      source: "turbineh.json" as const,
    }));
  return arr(planOf(r).criteria).map((c) => ({
    text: str(obj(c).criterion),
    status: (str(obj(c).status) || "open") as Criterion["status"],
    source: "plan" as const,
  }));
}

export interface RequirementScore {
  id: string;
  text: string;
  new: boolean;
  auto: ReqStatus;
  status: ReqStatus;
  reviewed: boolean;
  matched: string[];
}

/** Canonical requirements against the derived criteria (automatic), then a person's confirmation (review.json). */
export function scoreRequirements(
  s: Statement,
  r: StatementRun,
  review?: Review,
): RequirementScore[] {
  const crit = derivedCriteria(r);
  const removed = warningTexts(r);
  const generated = Boolean(r.guide) || Boolean(obj(resultOf(r).outcome).requirements);
  return (s.requirements ?? []).map((q) => {
    const hits = crit.filter((c) => matchesAll(q.match, c.text));
    let auto: ReqStatus;
    // Conservative: met only when every criterion it maps to is met (a person confirms or corrects it).
    if (generated && hits.length > 0 && hits.every((c) => c.status === "met")) auto = "met";
    else if (removed.some((t) => matchesAll(q.match, t))) auto = "removed";
    else auto = hits.length ? "open" : "missing";
    const override = review?.requirements?.[s.id]?.[q.id];
    return {
      id: q.id,
      text: q.text,
      new: Boolean(q.new),
      auto,
      status: override ?? auto,
      reviewed: Boolean(override),
      matched: hits.map((c) => `[${c.status}] ${c.text}`),
    };
  });
}

/** Section 9.2: criteria with a passing test / criteria (the reviewer's canonical list, confirmed by a person). */
export function functionalCoverage(scores: RequirementScore[]): number | null {
  return scores.length ? scores.filter((x) => x.status === "met").length / scores.length : null;
}

/**
 * Coverage of what the person approved: requirements removed explicitly before generating (band B, with consent) are
 * out of the delivered scope. Used for false "verified": a package is judged on the scope it was built for.
 */
export function approvedScopeCoverage(scores: RequirementScore[]): number | null {
  const inScope = scores.filter((x) => x.status !== "removed");
  return inScope.length ? inScope.filter((x) => x.status === "met").length / inScope.length : null;
}

/** The product's own number: met / derived criteria (what its badge says), to compare with the reviewer's. */
export function systemCoverage(r: StatementRun): { met: number; total: number } | null {
  const c = derivedCriteria(r);
  if (!r.guide && !obj(resultOf(r).outcome).requirements) return null;
  return { met: c.filter((x) => x.status === "met").length, total: c.length };
}

/** Which surfaces present the result as "verified" (state, outcome kind, turbineh.json, /v1/builds). */
export function verifiedClaims(r: StatementRun): string[] {
  const res = resultOf(r);
  const out = obj(res.outcome);
  const g = obj(r.guide);
  const claims: string[] = [];
  if (str(res.state) === "verified") claims.push("result.state=verified");
  if (["app_verified", "package_verified"].includes(str(out.kind)))
    claims.push(`outcome.kind=${str(out.kind)}`);
  if (str(g.status) === "verified" || g.verified === true) claims.push("turbineh.json verified");
  if (obj(r.build).verified === true) claims.push("builds.verified=true");
  return claims;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const ratio = (x: unknown): { passed: number; total: number } | null => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(str(x));
  return m ? { passed: Number(m[1]), total: Number(m[2]) } : null;
};

/**
 * Contradictions between surfaces (section 9.2 "Consistencia"): plan, result, next steps (outcome.left/actions),
 * turbineh.json and manifest.json. Only facts present on both sides are compared; each line names both values.
 */
export function contradictions(r: StatementRun): string[] {
  const out: string[] = [];
  const plan = planOf(r);
  const res = resultOf(r);
  const outcome = obj(res.outcome);
  const g = r.guide ? obj(r.guide) : null;
  const man = r.manifest ? obj(r.manifest) : null;
  const build = r.build ? obj(r.build) : null;
  if (!r.final) return out;

  // 1 · One state everywhere.
  if (build && str(build.state) && str(res.state) && str(build.state) !== str(res.state))
    out.push(`state: /v1/plans says "${str(res.state)}", /v1/builds says "${str(build.state)}"`);
  if (man && str(man.state) && str(res.state) && str(man.state) !== str(res.state))
    out.push(`state: result "${str(res.state)}", manifest.json "${str(man.state)}"`);
  const resVerified = str(res.state) === "verified";
  if (g && (str(g.status) === "verified") !== resVerified)
    out.push(`verified: result.state "${str(res.state)}", turbineh.json status "${str(g.status)}"`);

  // 2 · The same checks count.
  const oc = obj(outcome.checks);
  const oChecks =
    num(oc.total) !== null ? { passed: num(oc.passed) ?? 0, total: num(oc.total) ?? 0 } : null;
  const gChecks = g ? ratio(g.checks) : null;
  if (oChecks && gChecks && (oChecks.passed !== gChecks.passed || oChecks.total !== gChecks.total))
    out.push(
      `checks: outcome ${oChecks.passed}/${oChecks.total}, turbineh.json ${gChecks.passed}/${gChecks.total}`,
    );
  const mChecks = man ? arr(man.checks).map(obj) : [];
  if (oChecks && mChecks.length) {
    const own = mChecks.filter((c) => str(c.name) !== "certification");
    const passed = own.filter((c) => c.ok === true).length;
    if (own.length && (passed !== oChecks.passed || own.length !== oChecks.total))
      out.push(
        `checks: outcome ${oChecks.passed}/${oChecks.total}, manifest.json ${passed}/${own.length}`,
      );
  }

  // 3 · The same requirements count.
  const oq = obj(outcome.requirements);
  const gCrit = g ? arr(g.criteria).map(obj) : [];
  if (num(oq.total) !== null && gCrit.length) {
    const met = gCrit.filter((c) => str(c.status) === "met").length;
    if (met !== num(oq.met) || gCrit.length !== num(oq.total))
      out.push(
        `requirements: outcome ${num(oq.met)}/${num(oq.total)} met, turbineh.json ${met}/${gCrit.length} met`,
      );
  }

  // 4 · Next steps: "nothing left" while requirements are open, on any surface.
  const left = arr(outcome.left).map(str);
  const openOutcome = num(oq.total) !== null && (num(oq.met) ?? 0) < (num(oq.total) ?? 0);
  if (openOutcome && left.length === 0 && ["verified", "generated"].includes(str(res.state)))
    out.push(
      `next steps: outcome.left is empty while requirements are ${num(oq.met)}/${num(oq.total)} met`,
    );
  if (g) {
    const gOpen = gCrit.filter((c) => str(c.status) !== "met").length;
    if (gOpen > 0 && arr(g.left).length === 0)
      out.push(`next steps: turbineh.json left is empty while ${gOpen} criterion(s) are not met`);
  }

  // 5 · ADR-0052: removed requirements never come back as "left", "missing" or "Needs your configuration".
  const removed = arr(obj(plan.scope).removed).map((x) => norm(str(obj(x).requirement)));
  const leftTexts = [
    ...left,
    ...arr(plan.missing).map(str),
    ...arr(res.needs).map((n) => `${str(obj(n).name)} ${str(obj(n).why)}`),
    ...(g ? arr(g.left).map((x) => str(obj(x).what)) : []),
    ...(g ? arr(g.todo).map((x) => str(obj(x).what)) : []),
  ].map(norm);
  for (const rq of removed.filter((x) => x.length > 12))
    if (leftTexts.some((t) => t.includes(rq)))
      out.push(`scope: removed requirement "${rq}" reappears as work left or configuration`);

  // 5b · Next steps ask to check/test a criterion that turbineh.json already proves (met).
  const metTexts = gCrit.filter((c) => str(c.status) === "met").map((c) => norm(str(c.text)));
  const leftNorm = left.map(norm);
  for (const m of metTexts.filter((x) => x.length > 12))
    if (leftNorm.some((t) => t.includes(m)))
      out.push(
        `next steps: outcome.left lists a criterion turbineh.json marks met: "${m.slice(0, 90)}"`,
      );

  // 6 · The plan's components are the package's components.
  const planIds = new Set(arr(plan.components).map((c) => str(obj(c).id)));
  const manIds = new Set(man ? arr(man.components).map((c) => str(obj(c).id)) : []);
  if (planIds.size && manIds.size) {
    const onlyPlan = [...planIds].filter((x) => !manIds.has(x));
    const onlyMan = [...manIds].filter((x) => !planIds.has(x));
    if (onlyPlan.length)
      out.push(`components: in the plan, not in manifest.json: ${onlyPlan.join(", ")}`);
    if (onlyMan.length)
      out.push(`components: in manifest.json, not in the plan: ${onlyMan.join(", ")}`);
  }

  // 7 · A criterion the plan said a shipped test covers is still open after a passed gate.
  if (resVerified && g) {
    const final = new Map(gCrit.map((c) => [norm(str(c.text)), str(c.status)]));
    for (const c of arr(plan.criteria).map(obj))
      if (str(c.status) === "covered" && final.get(norm(str(c.criterion))) === "open")
        out.push(
          `criteria: plan "covered", turbineh.json "open" after a passed gate: ${str(c.criterion)}`,
        );
  }
  return out;
}

/** |real − estimate| / real (section 9.2 "Error de estimación"), lines and time. */
export function estimateErrors(r: StatementRun): {
  lines: { estimate: number; real: number; error: number } | null;
  time: { estimate: number; real: number; error: number } | null;
} {
  const est = obj(planOf(r).estimate);
  const m = obj(resultOf(r).metrics);
  const one = (e: number | null, real: number | null) =>
    e !== null && real !== null && real > 0
      ? { estimate: e, real, error: Math.abs(real - e) / real }
      : null;
  const realSeconds =
    num(m.seconds) && (num(m.seconds) ?? 0) > 0
      ? num(m.seconds)
      : r.timings.generateMs
        ? r.timings.generateMs / 1000
        : null;
  return {
    lines: r.guide || num(m.newLines) ? one(num(est.newLinesToMaintain), num(m.newLines)) : null,
    time: one(num(est.seconds), realSeconds),
  };
}

/**
 * Footprint (section 9.2 "Huella"): components and lines not linked to any criterion, when a surface exposes it
 * (`footprint` in the result, the build metrics or turbineh.json). Never inferred: null when not exposed.
 */
export function footprint(r: StatementRun): { share: number; detail: string } | null {
  for (const f of [
    obj(resultOf(r).footprint),
    obj(obj(obj(r.build).metrics).footprint),
    obj(obj(r.guide).footprint),
  ]) {
    const unlinkedLines = num(f.unlinkedLines);
    const totalLines = num(f.totalLines);
    if (unlinkedLines !== null && totalLines) {
      const comps = arr(f.unlinkedComponents).map(str);
      return {
        share: unlinkedLines / totalLines,
        detail: `${unlinkedLines}/${totalLines} lines${comps.length ? `; components: ${comps.join(", ")}` : ""}`,
      };
    }
    const share = num(f.share);
    if (share !== null) return { share, detail: JSON.stringify(f).slice(0, 200) };
  }
  return null;
}

export function costEur(r: StatementRun): number | null {
  const c = obj(obj(obj(r.build).metrics).cost);
  return num(c.totalEur);
}

export const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? null;
};
export const median = (xs: number[]) => percentile(xs, 50);

/** precision@5 of one query: relevant results among the first k (k = min(5, returned)) / k. */
export function precisionAt5(returned: string[], relevant: string[]): number {
  const top = returned.slice(0, 5);
  if (!top.length) return relevant.length ? 0 : 1;
  const rel = new Set(relevant);
  return top.filter((id) => rel.has(id)).length / top.length;
}

/** Section 9.2 thresholds, verbatim. */
export const THRESHOLDS = {
  coverageA: 0.9,
  coverageB: 0.7,
  gapRecallC: 1,
  falseVerified: 0,
  contradictions: 0,
  snippetsCompile: 1,
  discoverP5: 0.8,
  estimateMedianError: 0.25,
  footprint: 0.1,
  expertA: 4,
  falseVerifiedBelow: 0.8,
} as const;
