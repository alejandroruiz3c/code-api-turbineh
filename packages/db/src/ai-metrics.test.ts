import type pg from "pg";
import { describe, expect, it } from "vitest";
import { aiUsageTotals, recordAiRequest } from "./ai-metrics.js";

function pool(rows: unknown[] = []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const p = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
  return { db: p as unknown as pg.Pool, queries };
}

describe("AI request metrics (ADR-0060)", () => {
  it("stores numbers only, clamped and rounded", async () => {
    const { db, queries } = pool();
    await recordAiRequest(db, {
      ownerId: "o",
      appId: "a",
      surface: "chat",
      ok: true,
      latencyMs: 812.6,
      modelCalls: 2,
      inputTokens: -1,
      outputTokens: Number.NaN,
      costUsd: 0.000123456789,
      referenceCostUsd: -2,
    });
    expect(queries[0]?.sql).toContain("INSERT INTO ai_request_metrics");
    expect(queries[0]?.params).toEqual([
      "o",
      "a",
      "chat",
      true,
      813,
      2,
      0,
      0,
      "0.00012346",
      "0.00000000",
    ]);
  });

  it("totals and per-surface groups from the ROLLUP rows", async () => {
    const row = {
      requests: "3",
      failed: "1",
      model_calls: "6",
      input_tokens: "300",
      output_tokens: "30",
      cost_usd: "0.0003",
      reference_cost_usd: "0.0018",
      p50: 800,
      p95: 1200,
      since: new Date("2026-10-15T00:00:00Z"),
      until: new Date("2026-10-15T01:00:00Z"),
    };
    const { db, queries } = pool([
      { ...row, surface: "chat" },
      { ...row, surface: null },
    ]);
    const t = await aiUsageTotals(db, "o");
    expect(queries[0]?.sql).toContain("GROUP BY ROLLUP (surface)");
    expect(t.total).toEqual({
      requests: 3,
      failedRequests: 1,
      modelCalls: 6,
      inputTokens: 300,
      outputTokens: 30,
      costUsd: 0.0003,
      referenceCostUsd: 0.0018,
      latencyP50Ms: 800,
      latencyP95Ms: 1200,
      since: "2026-10-15T00:00:00.000Z",
      until: "2026-10-15T01:00:00.000Z",
    });
    expect(Object.keys(t.bySurface)).toEqual(["chat"]);
    const empty = await aiUsageTotals(pool([]).db, "o");
    expect(empty.total).toMatchObject({ requests: 0, latencyP50Ms: null, since: null });
  });
});
