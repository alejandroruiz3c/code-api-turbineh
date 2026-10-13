import {
  createJevDecider,
  createOpenDecider,
  FallbackDecider,
  type Decider,
} from "@turbineh/decider";

let cached: Decider | null | undefined;

/**
 * The decider for decisions taken while planning (ADR-0039 amendment: which app of a monorepo receives the
 * capability): JEV primary, open decider fallback, as selection in the worker. Keys come from the server environment
 * (the same key the AI gateway uses); null when none is configured — the caller then decides with code.
 */
export function planDecider(): Decider | null {
  if (cached !== undefined) return cached;
  const key = process.env.TYPESAFE_API_KEY || process.env.AI_GATEWAY_TYPESAFE_KEY;
  const openUrl = process.env.OPEN_DECIDER_BASE_URL;
  const jev = key ? createJevDecider(key) : null;
  const open = openUrl ? createOpenDecider(openUrl) : null;
  cached = jev && open ? new FallbackDecider(jev, open) : (jev ?? open);
  return cached;
}
