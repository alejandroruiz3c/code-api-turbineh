/**
 * Cost of a build for the daily circuit breaker (ADR-0008): tracked model tokens at list prices plus a configurable
 * overhead for what is not metered per build (decider requests, report writer, security fixer, compute).
 */
const PRICE_EUR_PER_M: Record<string, [number, number]> = {
  // Scaleway Generative APIs list prices (knowledge/modelos-ia, [oficial]).
  "gemma-4-26b-a4b-it": [0.25, 0.5],
  "deepseek-v4-flash-0731": [0.4, 0.8],
  "glm-5.2": [1.8, 5.5],
};
const FALLBACK: [number, number] = [1.8, 5.5]; // unknown model: price it like the most expensive one we use

interface Usage {
  input_tokens: number;
  output_tokens: number;
}

const eur = (u: Usage | undefined, model: string) => {
  if (!u) return 0;
  const [i, o] = PRICE_EUR_PER_M[model] ?? FALLBACK;
  return (u.input_tokens * i + u.output_tokens * o) / 1e6;
};

export function buildCost(
  metrics: Record<string, unknown>,
  compilerModel: string,
  overheadEur: number,
): { trackedEur: number; overheadEur: number; totalEur: number } {
  const m = metrics as {
    tokens?: { compiler?: Usage };
    integrated?: { usage?: Usage }[];
    backup?: { activations?: { usage?: Usage; model?: string }[] };
    corrections?: { usage?: Usage; by?: string }[];
  };
  const tracked =
    eur(m.tokens?.compiler, compilerModel) +
    (m.integrated ?? []).reduce((s, i) => s + eur(i.usage, compilerModel), 0) +
    (m.backup?.activations ?? []).reduce((s, a) => s + eur(a.usage, a.model ?? ""), 0) +
    (m.corrections ?? []).reduce((s, c) => s + eur(c.usage, c.by ?? ""), 0);
  const round = (n: number) => Math.round(n * 100_000) / 100_000;
  return {
    trackedEur: round(tracked),
    overheadEur: round(overheadEur),
    totalEur: round(tracked + overheadEur),
  };
}
