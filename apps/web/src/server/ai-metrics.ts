import type { AiApp, AiUsageGroup, AiUsageTotals } from "@turbineh/db";
import type { GatewayDeps } from "./ai-gateway";

/**
 * Per-request measurement of the AI gateway (ADR-0060), so that whoever tries TurbineH over the API or MCP can see
 * what each call cost and how long it took, and compare it with a frontier model:
 *   - cost_usd: the internal cost of the request's model and decision calls, exactly as charged to the trial
 *     (ai-cost.ts);
 *   - frontier_reference_cost_usd: the same input and output tokens priced at a frontier model's list price
 *     (FRONTIER_REFERENCE, the reference the agent benchmarks use) — an estimate, labelled as such;
 *   - savings_usd / savings_pct: the difference.
 * Deterministic: computed from the calls the gateway forwarded and billed during the request.
 */
export const FRONTIER_REFERENCE = {
  label: "frontier model reference (list price)",
  /** USD per million tokens (list price of the frontier model used as reference by the TurbineH benchmarks). */
  inputUsdPerM: 4,
  outputUsdPerM: 20,
} as const;

/** Product surfaces whose requests are measured and reported. */
export type Surface =
  "chat" | "chat-direct" | "orchestrate" | "agent" | "mcp:orchestrate" | "mcp:chat";

/** What the gateway billed while one request ran. */
export interface Meter {
  startedAt: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * The gateway's dependencies with billing observed for one request: every billed call (record + addSpend, see
 * ai-gateway.ts `charge`) is also added to the request's meter.
 */
export function metered(
  deps: GatewayDeps,
  startedAt: number = Date.now(),
): { deps: GatewayDeps; meter: Meter } {
  const meter: Meter = { startedAt, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    meter,
    deps: {
      ...deps,
      record: (u) => {
        meter.modelCalls += 1;
        meter.inputTokens += Math.max(0, u.inputTokens);
        meter.outputTokens += Math.max(0, u.outputTokens);
        return deps.record(u);
      },
      addSpend: (ownerId, usd) => {
        if (Number.isFinite(usd) && usd > 0) meter.costUsd += usd;
        return deps.addSpend(ownerId, usd);
      },
    },
  };
}

/** USD of `inputTokens`/`outputTokens` at the frontier reference's list price. */
export const referenceCostUsd = (inputTokens: number, outputTokens: number) =>
  (Math.max(0, inputTokens) * FRONTIER_REFERENCE.inputUsdPerM +
    Math.max(0, outputTokens) * FRONTIER_REFERENCE.outputUsdPerM) /
  1e6;

const usd = (n: number) => Number(n.toFixed(8));
const pct = (cost: number, reference: number) =>
  reference > 0 ? Number((((reference - cost) / reference) * 100).toFixed(1)) : 0;

/** Measurement of one request, as returned to the caller (`turbineh.metrics`, MCP `structuredContent.metrics`). */
export interface RequestMetrics {
  latency_ms: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  frontier_reference_cost_usd: number;
  frontier_reference: string;
  savings_usd: number;
  savings_pct: number;
}

export function metricsOf(meter: Meter, now: number = Date.now()): RequestMetrics {
  const reference = referenceCostUsd(meter.inputTokens, meter.outputTokens);
  return {
    latency_ms: Math.max(0, Math.round(now - meter.startedAt)),
    model_calls: meter.modelCalls,
    input_tokens: meter.inputTokens,
    output_tokens: meter.outputTokens,
    cost_usd: usd(meter.costUsd),
    frontier_reference_cost_usd: usd(reference),
    frontier_reference: FRONTIER_REFERENCE.label,
    savings_usd: usd(reference - meter.costUsd),
    savings_pct: pct(meter.costUsd, reference),
  };
}

/** Response headers of a measured request (X-TurbineH-Trial-Remaining-USD is added by trialHeaders). */
export const metricsHeaders = (m: RequestMetrics): Record<string, string> => ({
  "X-TurbineH-Latency-Ms": String(m.latency_ms),
  "X-TurbineH-Cost-USD": m.cost_usd.toFixed(8),
  "X-TurbineH-Frontier-Reference-Cost-USD": m.frontier_reference_cost_usd.toFixed(8),
  "X-TurbineH-Savings-Pct": String(m.savings_pct),
});

/** Stores one measured request for the account's usage report; requests without model calls are not stored. */
export async function recordRequest(
  app: AiApp,
  surface: Surface,
  ok: boolean,
  m: RequestMetrics,
  deps: GatewayDeps,
): Promise<void> {
  if (!deps.recordRequest || m.model_calls === 0) return;
  await deps
    .recordRequest({
      ownerId: app.ownerId,
      appId: app.id,
      surface,
      ok,
      latencyMs: m.latency_ms,
      modelCalls: m.model_calls,
      inputTokens: m.input_tokens,
      outputTokens: m.output_tokens,
      costUsd: m.cost_usd,
      referenceCostUsd: m.frontier_reference_cost_usd,
    })
    .catch(() => undefined);
}

/** One group of the usage report (snake_case, like the per-request metrics). */
export interface UsageGroupReport {
  requests: number;
  failed_requests: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: { p50: number | null; p95: number | null };
  cost_usd: number;
  frontier_reference_cost_usd: number;
  savings_usd: number;
  savings_pct: number;
}

const groupReport = (g: AiUsageGroup): UsageGroupReport => ({
  requests: g.requests,
  failed_requests: g.failedRequests,
  model_calls: g.modelCalls,
  input_tokens: g.inputTokens,
  output_tokens: g.outputTokens,
  latency_ms: { p50: g.latencyP50Ms, p95: g.latencyP95Ms },
  cost_usd: usd(g.costUsd),
  frontier_reference_cost_usd: usd(g.referenceCostUsd),
  savings_usd: usd(g.referenceCostUsd - g.costUsd),
  savings_pct: pct(g.costUsd, g.referenceCostUsd),
});

export interface UsageReport extends UsageGroupReport {
  object: "turbineh.usage_report";
  scope: string;
  since: string | null;
  until: string | null;
  frontier_reference: string;
  by_surface: Record<string, UsageGroupReport>;
  trial: {
    cap_usd: number | null;
    spent_usd: number;
    remaining_usd: number | null;
    reached: boolean;
  };
}

/** The account's cumulative report: totals and per surface, plus the trial balance. */
export function usageReportOf(
  totals: AiUsageTotals,
  trial: { capUsd: number | null; spentUsd: number; remainingUsd: number | null; reached: boolean },
): UsageReport {
  return {
    object: "turbineh.usage_report",
    scope: "all AI apps of this TurbineH account; measured requests (with at least one model call)",
    since: totals.total.since,
    until: totals.total.until,
    ...groupReport(totals.total),
    frontier_reference: FRONTIER_REFERENCE.label,
    by_surface: Object.fromEntries(
      Object.entries(totals.bySurface).map(([k, g]) => [k, groupReport(g)]),
    ),
    trial: {
      cap_usd: trial.capUsd,
      spent_usd: usd(trial.spentUsd),
      remaining_usd: trial.remainingUsd === null ? null : usd(trial.remainingUsd),
      reached: trial.reached,
    },
  };
}
