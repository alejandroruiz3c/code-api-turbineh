import { jsonrepair } from "jsonrepair";

const MAX_JSON_LENGTH = 1_000_000;

/**
 * Parses JSON written by a model, repairing common mistakes (code fences, single quotes, trailing commas).
 * Returns `unknown`: always validate the shape afterwards (zod or ai.schema-validation).
 */
export function parseModelJson(text: string): unknown {
  if (text.length > MAX_JSON_LENGTH) throw new Error("JSON is too large");
  return JSON.parse(jsonrepair(text));
}
