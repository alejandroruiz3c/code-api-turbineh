import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogFromFiles } from "./catalog-files.fixture.js";
import { searchCapabilities } from "./search.js";

/**
 * Discover relevance in CI (ADR-0066, audit §5.3 / §9.2): precision@5 over the 20 reference queries of the validation
 * benchmark (bench/validation/discover-queries.json) and a held-out set never used for tuning
 * (fixtures/discover-holdout.json), against the catalogue in git. Threshold of the audit: ≥ 0.8.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const catalog = catalogFromFiles(join(repo, "catalog/components"));

interface QuerySet {
  queries: { q: string; relevant: string[] }[];
}
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as QuerySet;

/** Same definition as bench/validation/metrics.ts: relevant among the first k (k = min(5, returned)) / k. */
function precisionAt5(returned: string[], relevant: string[]): number {
  const top = returned.slice(0, 5);
  if (!top.length) return relevant.length ? 0 : 1;
  const rel = new Set(relevant);
  return top.filter((id) => rel.has(id)).length / top.length;
}

function meanPrecision(set: QuerySet): { mean: number; worst: string } {
  const rows = set.queries.map(({ q, relevant }) => ({
    q,
    p: precisionAt5(
      searchCapabilities(q, catalog).map((r) => r.id),
      relevant,
    ),
  }));
  const worst = [...rows].sort((a, b) => a.p - b.p)[0];
  return {
    mean: rows.reduce((a, r) => a + r.p, 0) / rows.length,
    worst: `${worst?.q} (${worst?.p.toFixed(2)})`,
  };
}

describe("Discover precision@5", () => {
  it("is at least 0.8 on the 20 reference queries", () => {
    const set = load(join(repo, "bench/validation/discover-queries.json"));
    expect(set.queries.length).toBeGreaterThanOrEqual(20);
    const r = meanPrecision(set);
    expect(r.mean, `worst: ${r.worst}`).toBeGreaterThanOrEqual(0.8);
  });

  it("is at least 0.8 on held-out queries never used for tuning", () => {
    const r = meanPrecision(load(join(here, "fixtures/discover-holdout.json")));
    expect(r.mean, `worst: ${r.worst}`).toBeGreaterThanOrEqual(0.8);
  });

  it("answers 'support agent' with the AI agents use case, never colour pickers, YAML or i18n", () => {
    const ids = searchCapabilities("support agent", catalog).map((r) => r.id);
    expect(ids[0]).toBe("ai-agents");
    for (const off of ["ui.color-picker.react-colorful", "data.yaml.yaml", "ui.i18n.i18next"])
      expect(ids).not.toContain(off);
  });

  it("shows nothing below the minimum similarity (an unrelated need returns no results)", () => {
    expect(searchCapabilities("quantum entanglement telescope", catalog)).toEqual([]);
  });
});
