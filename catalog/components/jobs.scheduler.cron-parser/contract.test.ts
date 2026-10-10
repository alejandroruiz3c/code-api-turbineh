import { describe, expect, it } from "vitest";
import { CronExpressionParser } from "cron-parser";
describe("cron-parser contract", () => {
  it("computes the next run in a time zone", () => {
    const it2 = CronExpressionParser.parse("0 9 * * 1", {
      currentDate: new Date("2026-10-13T00:00:00Z"),
      tz: "UTC",
    });
    expect(it2.next().toISOString()).toBe("2026-10-19T09:00:00.000Z");
  });
});
