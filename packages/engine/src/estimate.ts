import type { EstimateCalibration, EstimateRange, EstimateVsActual, Plan } from "@turbineh/shared";
import { trackedTokens } from "./result.js";

/**
 * Calibrated plan estimates and persisted flow durations (ADR-0066). Pure functions: the worker reads the history
 * from the database and the web reads the row; nothing here measures time or calls a model.
 */

/** Finished runs of a recipe needed before its own history replaces the benchmark average. */
export const MIN_CALIBRATION_SAMPLES = 5;
/**
 * How many of the recipe's most recent runs each figure is calibrated on. Measured on staging history (90 finished
 * runs, 44 predicted chronologically, 2026-10-16; ADR-0066): time is noisy run to run, so more runs help (median
 * error 16.5 % with 10 vs 19.3 % with 50); new lines and tokens follow the recipe template and the glue cache, which
 * change between releases, so the latest runs predict best (lines 21.7 % with 3 vs 54.6 % with 50).
 */
export const CALIBRATION_WINDOW = { seconds: 10, tokens: 3, lines: 3 } as const;

/**
 * Duration of a finished run: persisted end minus persisted start, in milliseconds. null while the run has no end, or
 * when the timestamps are missing or inverted — never "now minus start".
 */
export function flowDurationMs(
  startedAt: string | Date | null | undefined,
  finishedAt: string | Date | null | undefined,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const s = new Date(startedAt).getTime();
  const f = new Date(finishedAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(f) || f < s) return null;
  return f - s;
}

/** Linear-interpolated percentile (p in 0..1) of a non-empty list; NaN for an empty one. */
export function percentile(values: readonly number[], p: number): number {
  const xs = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return Number.NaN;
  const pos = (xs.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (xs[lo] as number) + ((xs[hi] as number) - (xs[lo] as number)) * (pos - lo);
}

/** What one finished run really took. */
export interface RunSample {
  seconds: number;
  tokens: number;
  lines: number;
}

/** The persisted parts of a finished run that make a sample (see `runHistory` in @turbineh/db). */
export interface RunRecord {
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  metrics: Record<string, unknown>;
}

/** A finished run as a sample, or null when its duration is not persisted. */
export function runSample(r: RunRecord): RunSample | null {
  const ms = flowDurationMs(r.startedAt, r.finishedAt);
  if (ms === null) return null;
  const lines = (r.metrics.reuse as { generatedLines?: unknown } | undefined)?.generatedLines;
  return {
    seconds: Math.round(ms / 1000),
    tokens: trackedTokens(r.metrics),
    lines: typeof lines === "number" ? lines : 0,
  };
}

const range = (xs: number[]): EstimateRange => ({
  p50: Math.round(percentile(xs, 0.5)),
  p90: Math.round(percentile(xs, 0.9)),
});
const point = (x: number): EstimateRange => ({ p50: x, p90: x });

/**
 * The plan's estimate calibrated on the recipe's finished runs (most recent first; each figure on its
 * CALIBRATION_WINDOW): the point values become the medians and `calibration` carries the p50–p90 interval. With fewer than `minSamples` runs
 * the given estimate (benchmark average) is kept and labelled `benchmark`.
 */
export function calibrateEstimate(
  fallback: Plan["estimate"],
  history: readonly RunSample[],
  recipe: string | null,
  minSamples = MIN_CALIBRATION_SAMPLES,
): Plan["estimate"] {
  const runs = history.slice(0, Math.max(minSamples, CALIBRATION_WINDOW.seconds));
  if (runs.length < minSamples) {
    const calibration: EstimateCalibration = {
      basis: "benchmark",
      recipe,
      samples: runs.length,
      minSamples,
      seconds: point(fallback.seconds),
      tokens: point(fallback.tokens),
      newLinesToMaintain: point(fallback.newLinesToMaintain),
    };
    return { ...fallback, calibration };
  }
  const recent = (n: number) => runs.slice(0, n);
  const seconds = range(recent(CALIBRATION_WINDOW.seconds).map((r) => r.seconds));
  const tokens = range(recent(CALIBRATION_WINDOW.tokens).map((r) => r.tokens));
  const lines = range(recent(CALIBRATION_WINDOW.lines).map((r) => r.lines));
  return {
    seconds: seconds.p50,
    tokens: tokens.p50,
    newLinesToMaintain: lines.p50,
    costUsd: fallback.costUsd,
    calibration: {
      basis: "history",
      recipe,
      samples: runs.length,
      minSamples,
      window: {
        seconds: recent(CALIBRATION_WINDOW.seconds).length,
        tokens: recent(CALIBRATION_WINDOW.tokens).length,
        lines: recent(CALIBRATION_WINDOW.lines).length,
      },
      seconds,
      tokens,
      newLinesToMaintain: lines,
    },
  };
}

/** The plan's estimate next to the persisted actuals of the finished run (null while it runs or without a plan). */
export function estimateVsActual(
  plan: Pick<Plan, "estimate"> | null | undefined,
  run: RunRecord & { finished: boolean },
): EstimateVsActual | null {
  if (!plan?.estimate || !run.finished) return null;
  const s = runSample(run);
  const lines = (run.metrics.reuse as { generatedLines?: unknown } | undefined)?.generatedLines;
  const tokens = trackedTokens(run.metrics);
  return {
    estimate: plan.estimate,
    actual: {
      seconds: s?.seconds ?? null,
      tokens: tokens > 0 ? tokens : null,
      newLinesToMaintain: typeof lines === "number" ? lines : null,
    },
  };
}

/** |actual − estimate| / actual; null when the actual is 0 or unknown. */
export function relativeError(estimate: number, actual: number | null | undefined): number | null {
  if (actual === null || actual === undefined || !(actual > 0)) return null;
  return Math.abs(actual - estimate) / actual;
}

/**
 * Median relative error of the calibrated median, measured chronologically: each run (oldest first) is predicted
 * from the runs of the same recipe that finished before it, once there are at least `minSamples`. This is how the
 * estimate behaves for a new flow — it never sees its own run.
 */
export function backtest(
  runs: readonly (RunSample & { recipe: string })[],
  minSamples = MIN_CALIBRATION_SAMPLES,
): { predicted: number; seconds: number | null; tokens: number | null; lines: number | null } {
  const errs = { seconds: [] as number[], tokens: [] as number[], lines: [] as number[] };
  const seen = new Map<string, RunSample[]>();
  let predicted = 0;
  for (const r of runs) {
    const prior = seen.get(r.recipe) ?? [];
    if (prior.length >= minSamples) {
      const recent = [...prior].reverse();
      const e = calibrateEstimate(
        { seconds: 0, tokens: 0, newLinesToMaintain: 0, costUsd: 0 },
        recent,
        r.recipe,
        minSamples,
      );
      predicted += 1;
      for (const [k, est, act] of [
        ["seconds", e.seconds, r.seconds],
        ["tokens", e.tokens, r.tokens],
        ["lines", e.newLinesToMaintain, r.lines],
      ] as const) {
        const x = relativeError(est, act);
        if (x !== null) errs[k].push(x);
      }
    }
    seen.set(r.recipe, [...prior, r]);
  }
  const med = (xs: number[]) => (xs.length ? percentile(xs, 0.5) : null);
  return {
    predicted,
    seconds: med(errs.seconds),
    tokens: med(errs.tokens),
    lines: med(errs.lines),
  };
}
