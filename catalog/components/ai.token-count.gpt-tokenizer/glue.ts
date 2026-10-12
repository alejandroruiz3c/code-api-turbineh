import { decode, encode } from "gpt-tokenizer";

/**
 * Token budget helpers (BPE). Exact for BPE-family tokenizers; for other model families treat counts as an estimate
 * and keep a safety margin.
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/** Cuts `text` to at most `maxTokens` tokens (never splits inside a token). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (!Number.isInteger(maxTokens) || maxTokens < 0) throw new Error("Invalid token budget");
  const tokens = encode(text);
  return tokens.length <= maxTokens ? text : decode(tokens.slice(0, maxTokens));
}
