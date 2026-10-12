import type { Caller } from "./caller";
import { env } from "./env";

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/**
 * Internal operations access: cost and fleet data are TurbineH-internal and never shown to clients. Session users by
 * email (OPS_ADMIN_EMAILS), API keys by owner (OPS_OWNER_IDS, e.g. the benchmark/smoke keys).
 */
export function isOps(caller: Caller | null): boolean {
  if (!caller) return false;
  if (caller.kind === "session")
    return list(env.OPS_ADMIN_EMAILS).includes(caller.email.toLowerCase());
  return list(env.OPS_OWNER_IDS).includes(caller.ownerId.toLowerCase());
}

/** Scaleway list prices €/M tokens [oficial] for the gateway's chat models; others unpriced (n/d). Internal only. */
const AI_PRICE_EUR_PER_M: Record<string, [number, number]> = {
  "gemma-4-26b-a4b-it": [0.25, 0.5],
  "deepseek-v4-flash-0731": [0.4, 0.8],
  "glm-5.2": [1.8, 5.5],
};

/** Estimated provider cost of AI gateway usage [est.], or null when the model has no known price. */
export function aiUsageEur(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = AI_PRICE_EUR_PER_M[model];
  return p ? (inputTokens * p[0] + outputTokens * p[1]) / 1e6 : null;
}

/** Build metrics as a client sees them: internal cost data removed. */
export function clientMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metrics).filter(([k]) => k !== "cost"));
}
