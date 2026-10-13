/**
 * Acceptance criterion → test matching (ADR-0039 §4): precision and recall on the labelled pairs of
 * packages/shared/src/criterion-proof.fixtures.ts, for
 *   - the deterministic verdict alone (what acceptance rules and the report's first pass use);
 *   - deterministic, then the decider for pairs that pass the refusal/actor veto, accepted at confidence ≥ 0.9
 *     (what the report uses) — and, for comparison, at the previous 0.5.
 *
 *   pnpm --filter @turbineh/bench exec tsx agent-decisions/criteria.ts [--label name]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deciderFromEnv } from "@turbineh/decider";
import { criterionQuestion } from "@turbineh/reporter";
import { loadLocalEnv, proofVerdict, proofVeto, readEnv } from "@turbineh/shared";
import { PROOF_PAIRS } from "../../packages/shared/src/criterion-proof.fixtures";

const root = join(import.meta.dirname, "../..");
const LABEL = process.argv.includes("--label")
  ? (process.argv[process.argv.indexOf("--label") + 1] ?? "run")
  : "run";
loadLocalEnv(root);
const decider = deciderFromEnv(readEnv());
const NOT = "Not verified automatically";

const rows = [];
for (const p of PROOF_PAIRS) {
  const det = proofVerdict(p.criterion, p.test);
  const veto = proofVeto(p.criterion, p.test);
  let dec: { choice: string; confidence: number; ms: number; tokens: number } | null = null;
  if (!det.proven && !veto) {
    const e = `End-to-end test: ${p.test.title}`;
    const t0 = performance.now();
    const d = await decider.ask(
      { app: "Web application" },
      { c0: criterionQuestion(p.criterion, [e], { [e]: p.test.assertions ?? [] }) },
    );
    const a = d.answers.c0;
    dec = {
      choice:
        a?.type === "choice"
          ? a.choice === e
            ? "test"
            : a.choice === NOT
              ? "open"
              : a.choice
          : "?",
      confidence: a?.type === "choice" ? a.confidence : 0,
      ms: Math.round(performance.now() - t0),
      tokens: (d.meta.usage.input_tokens ?? 0) + (d.meta.usage.output_tokens ?? 0),
    };
  }
  rows.push({ id: p.id, met: p.met, deterministic: det.proven, veto, decider: dec });
}

const score = (pred: (r: (typeof rows)[number]) => boolean) => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of rows) {
    const m = pred(r);
    if (m && r.met) tp++;
    else if (m) fp++;
    else if (r.met) fn++;
  }
  return {
    precision: Number((tp / Math.max(1, tp + fp)).toFixed(3)),
    recall: Number((tp / Math.max(1, tp + fn)).toFixed(3)),
    tp,
    fp,
    fn,
    falsePositives: rows.filter((r) => pred(r) && !r.met).map((r) => r.id),
  };
};
const viaDecider = (min: number) => (r: (typeof rows)[number]) =>
  r.deterministic || (r.decider?.choice === "test" && r.decider.confidence >= min);
const asked = rows.flatMap((r) => (r.decider ? [r.decider] : []));
const summary = {
  label: LABEL,
  date: new Date().toISOString(),
  pairs: rows.length,
  positives: rows.filter((r) => r.met).length,
  deterministic: score((r) => r.deterministic),
  deterministicThenDecider090: score(viaDecider(0.9)),
  deterministicThenDecider080: score(viaDecider(0.8)),
  deterministicThenDecider050: score(viaDecider(0.5)),
  decider: {
    asked: asked.length,
    p50Ms: [...asked].sort((a, b) => a.ms - b.ms)[Math.floor(asked.length / 2)]?.ms ?? 0,
    tokens: asked.reduce((s, a) => s + a.tokens, 0),
  },
};
const dir = join(import.meta.dirname, "runs");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, `criteria-${LABEL}.json`),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
