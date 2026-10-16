import { describe, expect, it } from "vitest";
import {
  backtest,
  calibrateEstimate,
  estimateVsActual,
  flowDurationMs,
  percentile,
  runSample,
} from "./estimate.js";

const BENCH = { seconds: 162, tokens: 10_039, newLinesToMaintain: 500, costUsd: 0.004 };

describe("flowDurationMs (N-03)", () => {
  it("is finished_at − started_at", () => {
    expect(flowDurationMs("2026-10-16T09:00:00Z", "2026-10-16T09:05:49Z")).toBe(349_000);
    expect(flowDurationMs(new Date(0), new Date(1500))).toBe(1500);
  });
  it("is null without an end, or with inverted or invalid timestamps", () => {
    expect(flowDurationMs("2026-10-16T09:00:00Z", null)).toBeNull();
    expect(flowDurationMs(null, "2026-10-16T09:00:00Z")).toBeNull();
    expect(flowDurationMs("2026-10-16T09:05:00Z", "2026-10-16T09:00:00Z")).toBeNull();
    expect(flowDurationMs("nope", "2026-10-16T09:00:00Z")).toBeNull();
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe("calibrateEstimate (F-06)", () => {
  const runs = [300, 320, 340, 360, 400, 500].map((s, i) => ({
    seconds: s,
    tokens: 8000 + i * 1000,
    lines: 600 + i * 50,
  }));

  it("uses the recipe's history: medians as values, p50–p90 as the interval", () => {
    // Most recent first: time over the last 10 runs, tokens and new lines over the last 3.
    const e = calibrateEstimate(BENCH, runs, "bookings");
    expect(e.seconds).toBe(350);
    expect(e.tokens).toBe(9000);
    expect(e.newLinesToMaintain).toBe(650);
    expect(e.calibration).toMatchObject({
      basis: "history",
      recipe: "bookings",
      samples: 6,
      seconds: { p50: 350, p90: 450 },
      tokens: { p50: 9000, p90: 9800 },
      newLinesToMaintain: { p50: 650, p90: 690 },
    });
  });

  it("keeps the benchmark average, labelled, with fewer than the minimum runs", () => {
    const e = calibrateEstimate(BENCH, runs.slice(0, 4), "bookings");
    expect(e.seconds).toBe(162);
    expect(e.calibration).toMatchObject({
      basis: "benchmark",
      samples: 4,
      minSamples: 5,
      seconds: { p50: 162, p90: 162 },
    });
  });
});

describe("samples and estimate vs actual", () => {
  const metrics = {
    tokens: { compiler: { input_tokens: 4000, output_tokens: 1000 } },
    integrated: [{ usage: { input_tokens: 500, output_tokens: 500 } }],
    reuse: { generatedLines: 699 },
  };
  const run = {
    startedAt: "2026-10-16T09:00:00Z",
    finishedAt: "2026-10-16T09:05:49Z",
    metrics,
  };

  it("a finished run is a sample of its persisted duration, tracked tokens and new lines", () => {
    expect(runSample(run)).toEqual({ seconds: 349, tokens: 6000, lines: 699 });
    expect(runSample({ ...run, finishedAt: null })).toBeNull();
  });

  it("compares the plan's estimate with the run only when it has finished", () => {
    const plan = { estimate: BENCH };
    expect(estimateVsActual(plan, { ...run, finished: true })).toEqual({
      estimate: BENCH,
      actual: { seconds: 349, tokens: 6000, newLinesToMaintain: 699 },
    });
    expect(estimateVsActual(plan, { ...run, finished: false })).toBeNull();
    expect(estimateVsActual(null, { ...run, finished: true })).toBeNull();
  });
});

describe("backtest", () => {
  it("predicts each run only from earlier runs of the same recipe", () => {
    const runs = Array.from({ length: 8 }, (_, i) => ({
      recipe: "bookings",
      seconds: 300,
      tokens: 1000,
      lines: i === 7 ? 200 : 100,
    }));
    const r = backtest(runs, 5);
    expect(r.predicted).toBe(3);
    expect(r.seconds).toBe(0);
    // The last run (200 lines) was predicted 100: 50 % off; the two before were exact.
    expect(r.lines).toBe(0);
    expect(backtest(runs.slice(0, 5), 5).predicted).toBe(0);
  });
});
