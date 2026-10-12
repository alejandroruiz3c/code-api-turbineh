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

/** Build metrics as a client sees them: internal cost data removed. */
export function clientMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metrics).filter(([k]) => k !== "cost"));
}
