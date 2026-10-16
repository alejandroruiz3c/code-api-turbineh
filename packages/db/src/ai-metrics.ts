import type pg from "pg";

/**
 * Per-request metrics of the AI gateway (ADR-0060) and the per-account aggregate behind the usage report. Rows carry
 * numbers only (no prompts, no answers).
 */
export interface AiRequestMetric {
  ownerId: string;
  appId: string;
  /** chat | chat-direct | orchestrate | agent | mcp:orchestrate | mcp:chat */
  surface: string;
  ok: boolean;
  latencyMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  referenceCostUsd: number;
}

const int = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
const usd = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0).toFixed(8);

export async function recordAiRequest(db: pg.Pool, m: AiRequestMetric): Promise<void> {
  await db.query(
    `INSERT INTO ai_request_metrics (owner_id, app_id, surface, ok, latency_ms, model_calls, input_tokens,
       output_tokens, cost_usd, reference_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      m.ownerId,
      m.appId,
      m.surface.slice(0, 40),
      m.ok,
      int(m.latencyMs),
      int(m.modelCalls),
      int(m.inputTokens),
      int(m.outputTokens),
      usd(m.costUsd),
      usd(m.referenceCostUsd),
    ],
  );
}

/** Aggregate of one group of requests (an account, or one surface of it). Latency percentiles over successful ones. */
export interface AiUsageGroup {
  requests: number;
  failedRequests: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  referenceCostUsd: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  since: string | null;
  until: string | null;
}

export interface AiUsageTotals {
  total: AiUsageGroup;
  bySurface: Record<string, AiUsageGroup>;
}

interface Row {
  surface: string | null;
  requests: string;
  failed: string;
  model_calls: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cost_usd: string | null;
  reference_cost_usd: string | null;
  p50: number | null;
  p95: number | null;
  since: Date | null;
  until: Date | null;
}

const groupOf = (r: Row | undefined): AiUsageGroup => ({
  requests: Number(r?.requests ?? 0),
  failedRequests: Number(r?.failed ?? 0),
  modelCalls: Number(r?.model_calls ?? 0),
  inputTokens: Number(r?.input_tokens ?? 0),
  outputTokens: Number(r?.output_tokens ?? 0),
  costUsd: Number(r?.cost_usd ?? 0),
  referenceCostUsd: Number(r?.reference_cost_usd ?? 0),
  latencyP50Ms: r?.p50 ?? null,
  latencyP95Ms: r?.p95 ?? null,
  since: r?.since ? new Date(r.since).toISOString() : null,
  until: r?.until ? new Date(r.until).toISOString() : null,
});

/** Totals of an account's recorded requests (all of its AI apps), overall and per surface. */
export async function aiUsageTotals(db: pg.Pool, ownerId: string): Promise<AiUsageTotals> {
  const res = await db.query<Row>(
    `SELECT surface, count(*) AS requests, count(*) FILTER (WHERE NOT ok) AS failed,
       sum(model_calls) AS model_calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
       sum(cost_usd) AS cost_usd, sum(reference_cost_usd) AS reference_cost_usd,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p95,
       min(created_at) AS since, max(created_at) AS until
     FROM ai_request_metrics WHERE owner_id = $1
     GROUP BY ROLLUP (surface)`,
    [ownerId],
  );
  const total = res.rows.find((r) => r.surface === null);
  return {
    total: groupOf(total),
    bySurface: Object.fromEntries(
      res.rows.filter((r) => r.surface !== null).map((r) => [r.surface as string, groupOf(r)]),
    ),
  };
}
