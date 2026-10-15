import { describe, expect, it } from "vitest";
import { RRule } from "rrule";
describe("rrule contract", () => {
  it("expands weekly occurrences", () => {
    const rule = new RRule({
      freq: RRule.WEEKLY,
      count: 3,
      dtstart: new Date(Date.UTC(2026, 9, 13, 9)),
    });
    expect(rule.all().map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-10-13",
      "2026-10-20",
      "2026-10-27",
    ]);
    expect(rule.toString()).toContain("FREQ=WEEKLY");
  });
});
