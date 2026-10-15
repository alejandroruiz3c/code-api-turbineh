/**
 * Internal cost of one AI gateway call in USD (ADR-0053), for the trial cap only: never shown as a price list.
 * Open models: the provider's list price in EUR per million tokens (same table as the worker's build cost) converted
 * at EUR→USD 1.08 [est.]; the decider: the upper bound of its documented range [est.]. Unknown models are priced like
 * the most expensive one, so the cap is never under-counted.
 */
export const EUR_USD = 1.08;

const CHAT_EUR_PER_M: Record<string, [number, number]> = {
  "gemma-4-26b-a4b-it": [0.25, 0.5],
  "deepseek-v4-flash-0731": [0.4, 0.8],
  "glm-5.2": [1.8, 5.5],
};
const CHAT_FALLBACK: [number, number] = [1.8, 5.5];
/** Embeddings: [est.] ~0.01 per million tokens (knowledge/modelos-ia catalogue), rounded up. */
const EMBEDDING_EUR_PER_M = 0.02;
/** Decider: USD per million tokens, input and output alike [est.]. */
const DECIDER_USD_PER_M = 0.42;

export function callCostUsd(
  endpoint: "chat" | "embeddings" | "decider",
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const tin = Math.max(0, inputTokens);
  const tout = Math.max(0, outputTokens);
  if (endpoint === "decider") return ((tin + tout) * DECIDER_USD_PER_M) / 1e6;
  if (endpoint === "embeddings") return (tin * EMBEDDING_EUR_PER_M * EUR_USD) / 1e6;
  const [i, o] = CHAT_EUR_PER_M[model] ?? CHAT_FALLBACK;
  return ((tin * i + tout * o) * EUR_USD) / 1e6;
}
