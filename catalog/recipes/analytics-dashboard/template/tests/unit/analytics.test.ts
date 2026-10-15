import { describe, expect, it } from "vitest";
import { breakdown, dailySeries, kpis, previousPeriod } from "@/server/analytics";

const p = (day: string, category: string, value: number) => ({ day, category, value });

describe("analytics", () => {
  it("adds money-like values exactly and compares with the previous period", () => {
    const k = kpis(
      [p("2026-01-02", "A", 0.1), p("2026-01-03", "A", 0.2)],
      [p("2025-12-31", "A", 0.15)],
      2,
    );
    expect(k.total).toBe(0.3);
    expect(k.perDay).toBe(0.15);
    expect(k.change).toBe(100);
  });

  it("fills missing days with zero", () => {
    expect(
      dailySeries(
        [p("2026-01-01", "A", 5), p("2026-01-03", "B", 2)],
        "2026-01-01",
        "2026-01-03",
      ).map((d) => d.value),
    ).toEqual([5, 0, 2]);
  });

  it("groups small categories as Other", () => {
    const rows = ["a", "b", "c"].map((c, i) => p("2026-01-01", c, i + 1));
    expect(breakdown(rows, 2)).toEqual([
      { category: "c", value: 3 },
      { category: "b", value: 2 },
      { category: "Other", value: 1 },
    ]);
  });

  it("computes the previous period of the same length", () => {
    expect(previousPeriod("2026-01-11", "2026-01-20")).toEqual({
      from: "2026-01-01",
      to: "2026-01-10",
    });
  });
});
