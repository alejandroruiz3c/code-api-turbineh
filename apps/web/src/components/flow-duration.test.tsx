import type { EstimateVsActual, Plan } from "@turbineh/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comparisonRows, estimateView } from "../lib/estimate-format";
import { followFlow, type FollowEvent, type FollowSnapshot } from "../lib/flow-follow";
import { EstimateComparison } from "./estimate-comparison";
import { finishedLine, FlowView, type BuildResult } from "./flow-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

/**
 * N-03 (audit v2, ADR-0066): "Finished in" kept growing (2812 min for a flow that took ~5 min) and a finished flow
 * opened as "Generating · 0 s". The duration is the persisted end − start of the run, and the server-rendered state
 * is the first thing the page shows.
 */

const ID = "52eff6c8-0000-4000-8000-000000000000";
const EVENTS: FollowEvent[] = [
  {
    id: 1,
    phase: "queued",
    type: "queued",
    data: { mode: "generate" },
    at: "2026-10-16T09:00:00Z",
  },
  { id: 2, phase: "compiling", type: "start", data: {}, at: "2026-10-16T09:00:01Z" },
  { id: 3, phase: "done", type: "finished", data: { status: "done" }, at: "2026-10-16T09:05:49Z" },
];
const FINISHED: BuildResult = {
  status: "done",
  state: "verified",
  outcome: null,
  error: null,
  repo_url: null,
  improvement_build_id: null,
  started_at: "2026-10-16T09:00:00Z",
  finished_at: "2026-10-16T09:05:49Z",
  duration_ms: 349_000,
  metrics: {},
  artifact: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  // Opened two days later: the figure must not change.
  vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Finished in (N-03)", () => {
  it("is the persisted duration, whatever the time the page is opened", () => {
    expect(finishedLine(349_000)).toBe("Finished in 5 min 49 s.");
    expect(finishedLine(null)).toBe("Finished.");
    expect(finishedLine(undefined)).toBe("Finished.");
  });

  it("a finished flow renders its persisted state on the server — never 'Generating · 0 s'", () => {
    const html = renderToStaticMarkup(
      <FlowView id={ID} initial={{ result: FINISHED, events: EVENTS }} />,
    );
    expect(html).toContain("Finished in 5 min 49 s.");
    expect(html).not.toContain("Generating");
    expect(html).not.toContain("so far");
  });

  it("the follower starts from the server state and never drops back to an empty result", async () => {
    const snaps: FollowSnapshot<BuildResult>[] = [];
    const f = followFlow<BuildResult>(ID, {
      open: () => ({ addEventListener: () => undefined, close: () => undefined }),
      load: () => new Promise(() => undefined), // the API never answers
      onChange: (s) => snaps.push(s),
      initial: { result: FINISHED, events: EVENTS },
    });
    vi.advanceTimersByTime(3_000);
    f.stop();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.every((s) => s.result?.duration_ms === 349_000)).toBe(true);
    expect(snaps.every((s) => s.events.length === 3)).toBe(true);
  });
});

describe("estimates (F-06)", () => {
  const history: Plan["estimate"] = {
    seconds: 300,
    tokens: 9000,
    newLinesToMaintain: 700,
    costUsd: 0.004,
    calibration: {
      basis: "history",
      recipe: "bookings",
      samples: 10,
      minSamples: 5,
      window: { seconds: 10, tokens: 3, lines: 3 },
      seconds: { p50: 300, p90: 420 },
      tokens: { p50: 9000, p90: 14000 },
      newLinesToMaintain: { p50: 700, p90: 950 },
    },
  };

  it("shows a p50–p90 interval from history, and says where it comes from", () => {
    const v = estimateView(history);
    expect(v).toMatchObject({ seconds: "5–7 min", tokens: "9,000–14,000", lines: "700–950" });
    expect(v.basis).toBe(
      "Median to 90th percentile of finished bookings runs: time over the last 10, tokens and new lines over the last 3.",
    );
  });

  it("labels the benchmark average when there are too few runs", () => {
    const v = estimateView({
      seconds: 162,
      tokens: 10_039,
      newLinesToMaintain: 500,
      costUsd: 0.004,
      calibration: {
        basis: "benchmark",
        recipe: "bookings",
        samples: 2,
        minSamples: 5,
        seconds: { p50: 162, p90: 162 },
        tokens: { p50: 10_039, p90: 10_039 },
        newLinesToMaintain: { p50: 500, p90: 500 },
      },
    });
    expect(v.seconds).toBe("~3 min");
    expect(v.basis).toContain("Benchmark average: fewer than 5 finished runs");
  });

  it("puts the real values next to the estimate in the result", () => {
    const data: EstimateVsActual = {
      estimate: history,
      actual: { seconds: 349, tokens: null, newLinesToMaintain: 699 },
    };
    const rows = comparisonRows(data);
    expect(rows[0]).toMatchObject({
      actual: "6 min",
      deviation: "+16 % vs estimate",
      withinP90: true,
    });
    expect(rows[1]).toMatchObject({ actual: "not recorded", deviation: null });
    const html = renderToStaticMarkup(<EstimateComparison data={data} />);
    expect(html).toContain("Estimated vs real");
    expect(html).toContain("5–7 min");
  });
});
