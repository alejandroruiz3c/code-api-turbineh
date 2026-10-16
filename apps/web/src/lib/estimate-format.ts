import type { EstimateRange, EstimateVsActual, Plan } from "@turbineh/shared";

/**
 * How plan estimates read (F-06, ADR-0066): a p50–p90 interval of finished runs of the same recipe, or — with too few
 * runs — the benchmark average, said in words. Never a bare figure that looks measured for this flow.
 */

const n = (x: number) => Math.round(x).toLocaleString("en");

function secondsText(s: number): string {
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
}

export function secondsRange(r: EstimateRange): string {
  if (r.p50 === r.p90) return `~${secondsText(r.p50)}`;
  if (r.p90 < 90) return `${Math.round(r.p50)}–${Math.round(r.p90)} s`;
  const lo = Math.round(r.p50 / 60);
  const hi = Math.round(r.p90 / 60);
  return lo === hi ? `~${lo} min` : `${lo}–${hi} min`;
}

export function countRange(r: EstimateRange): string {
  return r.p50 === r.p90 ? `~${n(r.p50)}` : `${n(r.p50)}–${n(r.p90)}`;
}

export interface EstimateView {
  seconds: string;
  tokens: string;
  lines: string;
  /** Where the figures come from, in one sentence. */
  basis: string;
}

/** The plan's estimate as shown in the plan review and the CLI. */
export function estimateView(e: Plan["estimate"]): EstimateView {
  const c = e.calibration;
  const point = (x: number): EstimateRange => ({ p50: x, p90: x });
  const view = {
    seconds: secondsRange(c?.seconds ?? point(e.seconds)),
    tokens: countRange(c?.tokens ?? point(e.tokens)),
    lines: countRange(c?.newLinesToMaintain ?? point(e.newLinesToMaintain)),
  };
  const runs = `${c?.recipe ? `${c.recipe} ` : ""}runs`;
  if (c?.basis === "history")
    return {
      ...view,
      basis: c.window
        ? `Median to 90th percentile of finished ${runs}: time over the last ${c.window.seconds}, tokens and new lines over the last ${c.window.lines}.`
        : `Median to 90th percentile of the last ${c.samples} finished ${runs}.`,
    };
  return {
    ...view,
    basis: c
      ? `Benchmark average: fewer than ${c.minSamples} finished runs of this recipe${c.recipe ? ` (${c.recipe})` : ""} yet, so no interval.`
      : "Benchmark average, not calibrated on finished runs.",
  };
}

export interface ComparisonRow {
  label: string;
  estimated: string;
  actual: string;
  /** Real vs the estimated median, e.g. "+40 % vs estimate"; null when not comparable. */
  deviation: string | null;
  /** Real value at or under the estimated 90th percentile (history basis only). */
  withinP90: boolean | null;
}

/** Estimated vs real for a finished flow (persisted values only). */
export function comparisonRows(x: EstimateVsActual): ComparisonRow[] {
  const v = estimateView(x.estimate);
  const c = x.estimate.calibration;
  const row = (
    label: string,
    estimated: string,
    median: number,
    range: EstimateRange | undefined,
    actual: number | null,
    show: (a: number) => string,
  ): ComparisonRow => ({
    label,
    estimated,
    actual: actual === null ? "not recorded" : show(actual),
    deviation:
      actual === null || median <= 0
        ? null
        : `${actual >= median ? "+" : "−"}${Math.round((Math.abs(actual - median) / median) * 100)} % vs estimate`,
    withinP90: actual === null || c?.basis !== "history" || !range ? null : actual <= range.p90,
  });
  return [
    row("Time to the package", v.seconds, x.estimate.seconds, c?.seconds, x.actual.seconds, (a) =>
      secondsText(a),
    ),
    row("Model tokens", v.tokens, x.estimate.tokens, c?.tokens, x.actual.tokens, n),
    row(
      "New lines to maintain",
      v.lines,
      x.estimate.newLinesToMaintain,
      c?.newLinesToMaintain,
      x.actual.newLinesToMaintain,
      n,
    ),
  ];
}
