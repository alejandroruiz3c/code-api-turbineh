import type { AiApp } from "@turbineh/db";
import { describe, expect, it } from "vitest";
import { type GatewayDeps, gatewayConfig } from "./ai-gateway";
import {
  FRONTIER_REFERENCE,
  metered,
  metricsHeaders,
  metricsOf,
  recordRequest,
  referenceCostUsd,
  usageReportOf,
} from "./ai-metrics";

const APP = { id: "a1", ownerId: "trial:x" } as AiApp;
function deps(): GatewayDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    verifyToken: async () => null,
    admit: async () => ({ ok: true }),
    record: async () => {
      calls.push("record");
    },
    reserveHedge: async () => false,
    trialSpent: async () => 0,
    addSpend: async () => {
      calls.push("spend");
    },
    fetch,
    config: gatewayConfig({}),
  };
}

describe("per-request metrics (ADR-0060)", () => {
  it("metered deps add every billed call to the meter and still bill it", async () => {
    const d = deps();
    const { deps: m, meter } = metered(d, 1000);
    await m.record({
      appId: "a1",
      endpoint: "chat",
      model: "x",
      inputTokens: 1000,
      outputTokens: 10,
    });
    await m.addSpend("o", 0.001);
    await m.record({
      appId: "a1",
      endpoint: "decider",
      model: "d",
      inputTokens: -5,
      outputTokens: 2,
    });
    await m.addSpend("o", Number.NaN);
    expect(d.calls).toEqual(["record", "spend", "record", "spend"]);
    expect(meter).toEqual({
      startedAt: 1000,
      modelCalls: 2,
      inputTokens: 1000,
      outputTokens: 12,
      costUsd: 0.001,
    });
    const r = metricsOf(meter, 1750);
    expect(r).toEqual({
      latency_ms: 750,
      model_calls: 2,
      input_tokens: 1000,
      output_tokens: 12,
      cost_usd: 0.001,
      frontier_reference_cost_usd: 0.00424,
      frontier_reference: "frontier model reference (list price)",
      savings_usd: 0.00324,
      savings_pct: 76.4,
    });
    expect(metricsHeaders(r)).toEqual({
      "X-TurbineH-Latency-Ms": "750",
      "X-TurbineH-Cost-USD": "0.00100000",
      "X-TurbineH-Frontier-Reference-Cost-USD": "0.00424000",
      "X-TurbineH-Savings-Pct": "76.4",
    });
  });

  it("no tokens: zero reference and savings; the reference uses the documented list price", () => {
    expect(
      metricsOf({ startedAt: 5, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, 1),
    ).toMatchObject({ latency_ms: 0, frontier_reference_cost_usd: 0, savings_pct: 0 });
    expect(referenceCostUsd(1e6, 1e6)).toBe(
      FRONTIER_REFERENCE.inputUsdPerM + FRONTIER_REFERENCE.outputUsdPerM,
    );
  });

  it("stores requests with model calls only, and never throws", async () => {
    const d = deps();
    const m = metricsOf(
      { startedAt: 0, modelCalls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
      1,
    );
    await recordRequest(APP, "chat", true, m, d);
    const stored: unknown[] = [];
    d.recordRequest = async (x) => {
      stored.push(x);
    };
    await recordRequest(APP, "agent", false, { ...m, model_calls: 0 }, d);
    await recordRequest(APP, "agent", false, m, d);
    expect(stored).toEqual([
      expect.objectContaining({ ownerId: "trial:x", appId: "a1", surface: "agent", ok: false }),
    ]);
    d.recordRequest = async () => {
      throw new Error("db down");
    };
    await expect(recordRequest(APP, "chat", true, m, d)).resolves.toBeUndefined();
  });

  it("usage report without a trial cap and without requests", () => {
    const empty = {
      requests: 0,
      failedRequests: 0,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      referenceCostUsd: 0,
      latencyP50Ms: null,
      latencyP95Ms: null,
      since: null,
      until: null,
    };
    expect(
      usageReportOf(
        { total: empty, bySurface: {} },
        { capUsd: null, spentUsd: 0.5, remainingUsd: null, reached: false },
      ),
    ).toMatchObject({
      requests: 0,
      savings_pct: 0,
      latency_ms: { p50: null, p95: null },
      by_surface: {},
      trial: { cap_usd: null, spent_usd: 0.5, remaining_usd: null, reached: false },
    });
  });
});
