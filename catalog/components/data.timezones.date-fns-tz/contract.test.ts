import { describe, expect, it } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
describe("date-fns-tz contract", () => {
  it("formats and converts across time zones", () => {
    const utc = new Date("2026-10-13T08:00:00Z");
    expect(formatInTimeZone(utc, "Europe/Madrid", "HH:mm")).toBe("10:00");
    expect(fromZonedTime("2026-10-13 10:00", "Europe/Madrid").toISOString()).toBe(
      "2026-10-13T08:00:00.000Z",
    );
  });
});
