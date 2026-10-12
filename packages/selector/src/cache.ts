import { createHash } from "node:crypto";
import type { SelectionInput } from "./select.js";

/** Bump when the selection questions or policy change: older cache entries stop matching. */
const SELECTION_CACHE_VERSION = 1;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Cache key of a selection (PLAN §9 "caché de resoluciones", ADR-0027): the normalized BuildSpec parts the decider
 * sees (recipe, summary, acceptance criteria) plus every candidate card. A catalog change (new candidate, edited
 * manifest) changes the key, so cached selections never outlive the catalog they were made for.
 */
export function selectionCacheKey(input: SelectionInput): string {
  const candidates = Object.entries(input.candidates)
    .filter(([, cs]) => cs.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cap, cs]) => [
      cap,
      cs.map((c) => [c.id, createHash("sha256").update(c.card).digest("hex")]).sort(),
    ]);
  const payload = JSON.stringify({
    v: SELECTION_CACHE_VERSION,
    recipe: input.app.recipe,
    summary: norm(input.app.summary),
    criteria: input.app.acceptance_criteria.map(norm),
    candidates,
  });
  return createHash("sha256").update(payload).digest("hex");
}
