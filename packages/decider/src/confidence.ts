import type { Answer } from "./types.js";

/**
 * Confidence helpers following docs.typesafe.ai/confidence:
 * - Choice: (p_max − 1/n) / (1 − 1/n)
 * - Noul has no `confidence` field; |2p − 1| is used as its equivalent.
 * Thresholds are per action and live in policy code, never here.
 */
export function choiceConfidence(probabilities: Readonly<Record<string, number>>): number {
  const ps = Object.values(probabilities);
  const n = ps.length;
  if (n < 2) return 1;
  const pMax = Math.max(...ps);
  return Math.max(0, (pMax - 1 / n) / (1 - 1 / n));
}

export function noulConfidence(p: number): number {
  return Math.abs(2 * p - 1);
}

/** Ratio between the top two probabilities (∞ when the runner-up is 0). */
export function topTwoRatio(probabilities: Readonly<Record<string, number>>): number {
  const [a = 0, b = 0] = Object.values(probabilities).sort((x, y) => y - x);
  return b === 0 ? Number.POSITIVE_INFINITY : a / b;
}

export function confidenceOf(answer: Answer): number {
  return answer.type === "noul" ? noulConfidence(answer.noul) : answer.confidence;
}

/** Three-band routing: act / review / escalate. Bands are configured per action by the caller. */
export type Route = "act" | "review" | "escalate";

export function route(confidence: number, bands: { act: number; review: number }): Route {
  if (confidence >= bands.act) return "act";
  if (confidence >= bands.review) return "review";
  return "escalate";
}
