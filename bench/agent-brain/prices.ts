/**
 * List prices used by the agent brain comparison, USD per million tokens, each with its source label.
 * Sources: ../knowledge/modelos-ia/04-modelos-cerrados-api/anthropic-claude.md (Claude) and
 * ../knowledge/modelos-ia/03-guias-transversales/costes-y-precios-api.md (Scaleway Generative APIs, EUR).
 */
export const EUR_USD = 1.08; // [est.]

interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  label: string;
}

export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": {
    input: 4,
    output: 20,
    cacheRead: 0.2,
    cacheWrite: 5,
    label: "[oficial] $4/$20, cache read $0.20; cache write 1.25x input [est.]",
  },
  "gemma-4-26b-a4b-it": {
    input: 0.25 * EUR_USD,
    output: 0.5 * EUR_USD,
    label: "[oficial] Scaleway EUR 0.25/0.50, EUR->USD 1.08 [est.]",
  },
  "deepseek-v4-flash-0731": {
    input: 0.4 * EUR_USD,
    output: 0.8 * EUR_USD,
    label: "[oficial] Scaleway EUR 0.40/0.80, EUR->USD 1.08 [est.]",
  },
  "glm-5.2": {
    input: 1.8 * EUR_USD,
    output: 5.5 * EUR_USD,
    label: "[oficial] Scaleway EUR 1.80/5.50, EUR->USD 1.08 [est.]",
  },
  decider: {
    input: 0.42,
    output: 0.42,
    label:
      "[est.] JEV, upper bound of the documented range (same constant as bench/frontiers/brain.ts)",
  },
};

export interface Usage {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function costOf(usage: readonly Usage[]): number {
  let usd = 0;
  for (const u of usage) {
    const p = PRICES[u.model];
    if (!p) throw new Error(`no price for ${u.model}`);
    usd +=
      (u.input * p.input +
        u.output * p.output +
        (u.cacheRead ?? 0) * (p.cacheRead ?? p.input) +
        (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) /
      1e6;
  }
  return usd;
}
