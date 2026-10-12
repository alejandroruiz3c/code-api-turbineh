import { parse } from "partial-json";

/**
 * Best-effort value of JSON that is still streaming (for progressive display only). Returns undefined while there is
 * nothing parseable yet; validate the final value once the stream ends.
 */
export function parseStreamingJson(text: string): unknown {
  try {
    return text.trim() ? (parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
