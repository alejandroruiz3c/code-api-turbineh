/**
 * Scores a validation run (audit report v2, section 9.2) and writes bench/validation/RESULTS.md, plus, next to the raw
 * runs, summary.json and review-sheet.md (the automatic requirement mapping for a person to confirm in review.json).
 *
 *   tsx bench/validation/report.ts --run 2026-10-16-staging
 *
 * Every figure comes from runs/<run>/*.json, statements.json and review.json; nothing is typed by hand.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvedScopeCoverage,
  type Band,
  contradictions,
  costEur,
  derivedCriteria,
  estimateErrors,
  footprint,
  functionalCoverage,
  gapsWarned,
  median,
  observedOutcome,
  outcomeOk,
  percentile,
  type Review,
  type Statement,
  type StatementRun,
  scoreRequirements,
  systemCoverage,
  THRESHOLDS,
  verifiedClaims,
  warnedBeforeGenerating,
} from "./metrics.ts";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const runs = readdirSync(join(here, "runs")).filter((d) =>
  existsSync(join(here, "runs", d, "meta.json")),
);
const RUN = argv.includes("--run") ? argv[argv.indexOf("--run") + 1] : runs.sort().at(-1);
if (!RUN) throw new Error("No run in bench/validation/runs");
const dir = join(here, "runs", RUN);
const read = <T>(f: string): T | null =>
  existsSync(join(dir, f)) ? (JSON.parse(readFileSync(join(dir, f), "utf8")) as T) : null;
const meta = read<{ env: string; api: string; startedAt: string; statements: string[] }>(
  "meta.json",
);
const review = read<Review>("review.json") ?? {};
const { statements } = JSON.parse(readFileSync(join(here, "statements.json"), "utf8")) as {
  statements: Statement[];
};
const byId = new Map(statements.map((s) => [s.id, s]));
const raw = readdirSync(dir)
  .filter((f) => /^[ABC]\d\d\.json$/.test(f))
  .map((f) => read<StatementRun>(f) as StatementRun)
  .sort((a, b) => a.id.localeCompare(b.id));

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)} %`);
const sec = (ms: number | null) => (ms === null ? "n/a" : `${Math.round(ms / 1000)} s`);

const rows = raw.map((r) => {
  const s = byId.get(r.id) as Statement;
  const reqs = scoreRequirements(s, r, review);
  const coverage = s.band === "C" ? null : functionalCoverage(reqs);
  const dismissed = new Set((review.dismissedContradictions?.[r.id] ?? []).map((d) => d.text));
  const contra = contradictions(r).filter((c) => !dismissed.has(c));
  const claims = verifiedClaims(r);
  const finalState = String((r.final?.result as Record<string, unknown> | undefined)?.state ?? "");
  const outcome = (r.final?.result as Record<string, unknown> | undefined)?.outcome as
    Record<string, unknown> | undefined;
  const plan = (r.final?.plan ?? r.plan?.body ?? {}) as Record<string, unknown>;
  const problem = (r.plan?.problem ?? {}) as Record<string, unknown>;
  const offer = ((problem.explanation as Record<string, unknown> | undefined)?.offer ??
    (
      (plan.scope as Record<string, unknown> | undefined)?.explanation as
        Record<string, unknown> | undefined
    )?.offer) as Record<string, unknown> | undefined;
  return {
    id: r.id,
    band: s.band,
    phase: r.phase,
    error: r.error,
    flowId: r.flowId,
    expected: s.expected,
    observed: observedOutcome(r),
    outcomeOk: outcomeOk(s, r),
    warned: warnedBeforeGenerating(r),
    gaps: gapsWarned(s, r),
    finalState: finalState || null,
    badge: (outcome?.badge as string | undefined) ?? null,
    checks: outcome?.checks ?? null,
    coverage,
    systemCoverage: systemCoverage(r),
    requirements: reqs,
    derived: derivedCriteria(r),
    removed:
      ((plan.scope as Record<string, unknown> | undefined)?.removed as unknown[] | undefined)
        ?.length ?? 0,
    offer: offer
      ? {
          title: offer.title ?? null,
          components: ((offer.components as { id: string }[] | undefined) ?? []).map((c) => c.id),
          coreNotIncluded: offer.coreNotIncluded ?? null,
        }
      : null,
    approved: r.approved,
    verifiedClaims: claims,
    scopeCoverage: s.band === "C" ? null : approvedScopeCoverage(reqs),
    falseVerified:
      claims.length > 0 &&
      s.band !== "C" &&
      (approvedScopeCoverage(reqs) ?? 1) < THRESHOLDS.falseVerifiedBelow,
    contradictions: contra,
    estimate: estimateErrors(r),
    footprint: footprint(r),
    wallMs: r.timings.wallMs,
    planMs: r.timings.planMs,
    generateMs: r.timings.generateMs,
    toVerifiedMs: finalState === "verified" ? r.timings.wallMs : null,
    costEur: costEur(r),
    expert: review.expert?.[r.id] ?? null,
  };
});

const band = (b: Band) => rows.filter((r) => r.band === b);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const covOf = (b: Band) =>
  mean(
    band(b)
      .map((r) => r.coverage)
      .filter((x): x is number => x !== null),
  );
const cBand = band("C");
const discover = read<{
  rows: { q: string; returned: string[]; p5: number; httpStatus: number }[];
}>("discover.json");
const snippets = read<{ exposed: boolean; rows: { id: string; compiles: boolean | null }[] }>(
  "snippets.json",
);
const lineErr = rows
  .map((r) => r.estimate.lines?.error)
  .filter((x): x is number => x !== undefined);
const timeErr = rows.map((r) => r.estimate.time?.error).filter((x): x is number => x !== undefined);
const fp = rows.map((r) => r.footprint?.share).filter((x): x is number => x !== undefined);
const snipRows = snippets?.rows.filter((r) => r.compiles !== null) ?? [];
const expertA = band("A")
  .map((r) => r.expert)
  .filter((x): x is number => x !== null);
const reviewed = rows.every((r) => r.requirements.every((q) => q.reviewed));

type Verdict = "pass" | "fail" | "n/a" | "manual";
const verdict = (v: number | null, ok: (x: number) => boolean): Verdict =>
  v === null ? "n/a" : ok(v) ? "pass" : "fail";
const metrics: { metric: string; value: string; threshold: string; n: string; verdict: Verdict }[] =
  [
    {
      metric: "Functional coverage · band A",
      value: pct(covOf("A")),
      threshold: "≥ 90 %",
      n: `${band("A").length}/10`,
      verdict: verdict(covOf("A"), (x) => x >= THRESHOLDS.coverageA),
    },
    {
      metric: "Functional coverage · band B",
      value: pct(covOf("B")),
      threshold: "≥ 70 %",
      n: `${band("B").length}/10`,
      verdict: verdict(covOf("B"), (x) => x >= THRESHOLDS.coverageB),
    },
    {
      metric: "Gap-detection recall · band C (warned before generating)",
      value: cBand.length ? `${cBand.filter((r) => r.warned).length}/${cBand.length}` : "n/a",
      threshold: "100 %",
      n: `${cBand.length}/10`,
      verdict: verdict(
        cBand.length ? cBand.filter((r) => r.warned).length / cBand.length : null,
        (x) => x >= 1,
      ),
    },
    {
      metric: 'False "verified" (coverage < 80 %)',
      value: String(rows.filter((r) => r.falseVerified).length),
      threshold: "0",
      n: `${rows.filter((r) => r.coverage !== null).length} scored`,
      verdict: rows.some((r) => r.coverage !== null)
        ? rows.some((r) => r.falseVerified)
          ? "fail"
          : "pass"
        : "n/a",
    },
    {
      metric: 'Info · "verified" with the product\'s own requirements < 80 % met',
      value: String(
        rows.filter(
          (r) =>
            r.verifiedClaims.length > 0 &&
            r.systemCoverage !== null &&
            r.systemCoverage.total > 0 &&
            r.systemCoverage.met / r.systemCoverage.total < THRESHOLDS.falseVerifiedBelow,
        ).length,
      ),
      threshold: "— (not in 9.2)",
      n: `${rows.filter((r) => r.systemCoverage).length} delivered`,
      verdict: "n/a",
    },
    {
      metric: "Contradictions between surfaces",
      value: String(rows.reduce((a, r) => a + r.contradictions.length, 0)),
      threshold: "0",
      n: `${rows.filter((r) => r.flowId).length} flows`,
      verdict: rows.some((r) => r.flowId)
        ? rows.some((r) => r.contradictions.length)
          ? "fail"
          : "pass"
        : "n/a",
    },
    {
      metric: "Snippets that compile",
      value: snipRows.length
        ? `${snipRows.filter((r) => r.compiles).length}/${snipRows.length}`
        : "not exposed",
      threshold: "100 %",
      n: `${snippets?.rows.length ?? 0} snippets`,
      verdict: snipRows.length ? (snipRows.every((r) => r.compiles) ? "pass" : "fail") : "n/a",
    },
    {
      metric: "Discover precision@5 (20 reference queries)",
      value: discover ? (mean(discover.rows.map((d) => d.p5)) ?? 0).toFixed(2) : "n/a",
      threshold: "≥ 0.8",
      n: `${discover?.rows.length ?? 0} queries`,
      verdict: verdict(
        discover ? mean(discover.rows.map((d) => d.p5)) : null,
        (x) => x >= THRESHOLDS.discoverP5,
      ),
    },
    {
      metric: "Estimate error, median · lines",
      value: pct(median(lineErr)),
      threshold: "< 25 %",
      n: `${lineErr.length} flows`,
      verdict: verdict(median(lineErr), (x) => x < THRESHOLDS.estimateMedianError),
    },
    {
      metric: "Estimate error, median · time",
      value: pct(median(timeErr)),
      threshold: "< 25 %",
      n: `${timeErr.length} flows`,
      verdict: verdict(median(timeErr), (x) => x < THRESHOLDS.estimateMedianError),
    },
    {
      metric: "Time to verified p50 / p95 per band",
      value: (["A", "B"] as Band[])
        .map((b) => {
          const xs = band(b)
            .map((r) => r.toVerifiedMs)
            .filter((x): x is number => x !== null);
          return `${b}: ${sec(percentile(xs, 50))} / ${sec(percentile(xs, 95))}`;
        })
        .join(" · "),
      threshold: "published and consistent with the landing",
      n: `${rows.filter((r) => r.toVerifiedMs !== null).length} verified`,
      verdict: "manual",
    },
    {
      metric: "Footprint (components/lines not linked to a criterion)",
      value: fp.length ? pct(mean(fp)) : "not exposed",
      threshold: "< 10 %",
      n: `${fp.length} flows`,
      verdict: verdict(fp.length ? mean(fp) : null, (x) => x < THRESHOLDS.footprint),
    },
    {
      metric: "Expert review, band A (blind, 1–5)",
      value: expertA.length ? (mean(expertA) ?? 0).toFixed(1) : "pending",
      threshold: "mean ≥ 4",
      n: `${expertA.length}/10`,
      verdict: expertA.length ? verdict(mean(expertA), (x) => x >= THRESHOLDS.expertA) : "manual",
    },
  ];

const wallBy = (b: Band) => band(b).map((r) => r.wallMs);
const costs = rows.map((r) => r.costEur).filter((x): x is number => x !== null);
const complete = rows.length === 30 && rows.every((r) => r.phase === "done");
const summary = {
  run: RUN,
  env: meta?.env ?? null,
  api: meta?.api ?? null,
  startedAt: meta?.startedAt ?? null,
  statements: rows.length,
  complete,
  requirementsReviewed: reviewed,
  metrics,
  wall: Object.fromEntries(
    (["A", "B", "C"] as Band[]).map((b) => [
      b,
      {
        p50s: (percentile(wallBy(b), 50) ?? 0) / 1000,
        p95s: (percentile(wallBy(b), 95) ?? 0) / 1000,
        n: wallBy(b).length,
      },
    ]),
  ),
  cost: { flowsWithCost: costs.length, totalEur: costs.reduce((a, b) => a + b, 0) },
  rows,
};
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

// Review sheet: the automatic mapping, for a person to confirm (review.json overrides it).
writeFileSync(
  join(dir, "review-sheet.md"),
  `# Review sheet · ${RUN}

Confirm each automatic status in \`review.json\` (\`{"requirements": {"A01": {"R1": "met"}}, "expert": {"A01": 4}}\`):
\`met\` (a passing test proves it), \`open\` (derived, not proven), \`removed\` (explicitly removed or refused before
generating), \`missing\` (not derived at all). Then re-run report.ts.

${rows
  .map(
    (r) => `## ${r.id} · band ${r.band} · ${r.observed} · ${r.badge ?? r.finalState ?? "no result"}

Derived criteria (${r.derived.length}, from ${r.derived[0]?.source ?? "—"}):
${r.derived.map((c) => `- [${c.status}] ${c.text}`).join("\n") || "- none"}

| Req | Canonical requirement | Auto | Confirmed | Matched criteria |
|---|---|---|---|---|
${r.requirements.map((q) => `| ${q.id}${q.new ? " (new)" : ""} | ${q.text} | ${q.auto} | ${q.reviewed ? q.status : "—"} | ${q.matched.join("<br>") || "—"} |`).join("\n") || "| — | (band C: no canonical requirements) | | | |"}
`,
  )
  .join("\n")}`,
);

const yes = (b: boolean) => (b ? "yes" : "no");
const md = `# Go-validation benchmark — results

Generated by \`bench/validation/report.ts\` from \`bench/validation/runs/${RUN}/\` (raw API answers per statement,
\`discover.json\`, \`snippets.json\`, \`review.json\`). Protocol: audit report v2, section 9; statements and labels:
\`statements.json\`; Discover reference set: \`discover-queries.json\`. Do not edit by hand.

- Run: \`${RUN}\` · environment: **${meta?.env ?? "?"}** (${meta?.api ?? "?"}) · started ${meta?.startedAt ?? "?"}
- Statements scored: **${rows.length}/30**${complete ? "" : " — **incomplete sample: not a go/no-go result**"}
- Requirement mapping confirmed by a person: **${yes(reviewed)}**${reviewed ? "" : " (automatic regex mapping; see review-sheet.md)"}

## Section 9.2 metrics

| Metric | Value | Go threshold | Sample | Verdict |
|---|---|---|---|---|
${metrics.map((m) => `| ${m.metric} | ${m.value} | ${m.threshold} | ${m.n} | ${m.verdict} |`).join("\n")}

Wall time per band (plan → final state; band C stops at the plan unless offers are generated):
${(["A", "B", "C"] as Band[]).map((b) => `${b} p50 ${sec(percentile(wallBy(b), 50))} · p95 ${sec(percentile(wallBy(b), 95))} (n=${wallBy(b).length})`).join(" · ")}.
Cost: ${costs.length ? `€${summary.cost.totalEur.toFixed(4)} over ${costs.length} flow(s) (worker \`metrics.cost.totalEur\`)` : "not exposed to this key (staff-only `metrics.cost`)"}.

## Per statement

| Id | Band | Expected | Observed | Outcome OK | Warned | Final state / badge | Coverage (reviewer) | Approved scope | Coverage (product) | "Verified" claims | Contradictions | Est. error lines / time | Wall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.id} | ${r.band} | ${r.expected} | ${r.observed}${r.phase === "error" ? ` (error: ${r.error})` : ""} | ${yes(r.outcomeOk)} | ${r.band === "A" ? "—" : yes(r.warned)} | ${r.badge ?? r.finalState ?? "—"} | ${pct(r.coverage)} | ${pct(r.scopeCoverage)} | ${r.systemCoverage ? `${r.systemCoverage.met}/${r.systemCoverage.total}` : "n/a"} | ${r.verifiedClaims.join(", ") || "—"} | ${r.contradictions.length} | ${pct(r.estimate.lines?.error ?? null)} / ${pct(r.estimate.time?.error ?? null)} | ${sec(r.wallMs)} |`,
  )
  .join("\n")}

${rows.some((r) => r.contradictions.length) ? `### Contradictions\n\n${rows.flatMap((r) => r.contradictions.map((c) => `- ${r.id}: ${c}`)).join("\n")}\n` : ""}
${
  rows.some((r) => r.offer)
    ? `### Offers\n\n${rows
        .filter((r) => r.offer)
        .map(
          (r) =>
            `- ${r.id}: ${String(r.offer?.title)} — components ${r.offer?.components.join(", ") || "none"}; core not included: ${String(r.offer?.coreNotIncluded)}`,
        )
        .join("\n")}\n`
    : ""
}
${
  rows.some((r) => r.gaps.length)
    ? `### Gaps warned before generating (bands B and C)\n\n${rows
        .filter((r) => r.gaps.length)
        .map(
          (r) =>
            `- ${r.id}: ${r.gaps.map((g) => `${g.gap} → ${g.warned ? "warned" : "**not warned**"}`).join("; ")}`,
        )
        .join("\n")}\n`
    : ""
}
${discover ? `### Discover precision@5\n\n| Query | p@5 | Top results |\n|---|---|---|\n${discover.rows.map((d) => `| ${d.q} | ${d.p5.toFixed(2)} | ${d.returned.join(", ") || "—"} |`).join("\n")}\n` : ""}
## Method notes

- Functional coverage = canonical requirements met / canonical requirements (band B includes its new capabilities,
  which count as not met when removed). A requirement is met only when the delivered criteria matching it are all
  \`met\` in turbineh.json (a passing test); the automatic mapping is a regex proposal confirmed in review.json. Band A/B flows refused before generating score 0.
- Gap-detection recall: a band C flow counts as warned when it is refused (\`use_case_not_covered\`), turned into a
  components-only offer, or reduced to a partial plan with removed requirements, before anything is generated.
- "Verified" claims: \`result.state = verified\`, \`outcome.kind\` app/package verified, turbineh.json \`status\`
  verified, or \`/v1/builds.verified\`. False "verified" = any claim with reviewer coverage < 80 % of the approved
  scope (requirements removed explicitly before generating, with the person's approval, are out of that scope).
- Contradictions: state, checks and requirement counts, next steps vs open requirements, removed scope reappearing as
  work left, plan vs manifest components, and plan "covered" criteria still open after a passed gate.
- Estimate error = |real − estimate| / real, with \`plan.estimate\` against \`result.metrics\` (newLines, seconds).
`;
// YES IF runs publish bench/validation/RESULTS.md; comparison runs (section 11.3) keep theirs next to the raw runs.
const resultsFile = String(meta?.env ?? "").startsWith("claude-code")
  ? join(dir, "RESULTS.md")
  : join(here, "RESULTS.md");
writeFileSync(resultsFile, md);
console.log(
  JSON.stringify(
    {
      run: RUN,
      statements: rows.length,
      metrics: metrics.map((m) => `${m.metric}: ${m.value} (${m.verdict})`),
    },
    null,
    2,
  ),
);
