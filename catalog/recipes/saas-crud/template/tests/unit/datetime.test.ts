import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  isTimeZone,
  localDateTime,
  timeZone,
  toDateTimeInput,
  zonedToUtc,
} from "@/lib/datetime";

describe("dates and times typed in a form are stored in UTC with their zone", () => {
  it("converts a local time to the UTC instant of its zone (summer and winter)", () => {
    expect(zonedToUtc("2026-07-01T10:30", "Europe/Madrid").toISOString()).toBe(
      "2026-07-01T08:30:00.000Z",
    );
    expect(zonedToUtc("2026-01-15T10:30", "Europe/Madrid").toISOString()).toBe(
      "2026-01-15T09:30:00.000Z",
    );
    expect(zonedToUtc("2026-01-15T10:30", "America/New_York").toISOString()).toBe(
      "2026-01-15T15:30:00.000Z",
    );
    expect(zonedToUtc("2026-01-15T10:30", "UTC").toISOString()).toBe("2026-01-15T10:30:00.000Z");
  });

  it("shows a stored instant back in the zone it was typed in", () => {
    const at = zonedToUtc("2026-07-01T10:30", "Europe/Madrid");
    expect(toDateTimeInput(at, "Europe/Madrid")).toBe("2026-07-01T10:30");
    expect(formatDateTime(at, "Europe/Madrid")).toBe("2026-07-01 10:30 (Europe/Madrid)");
    expect(toDateTimeInput(null, "UTC")).toBe("");
  });

  it("accepts only real local dates and IANA zones (UTC when none is sent)", () => {
    expect(localDateTime.safeParse("2026-10-13T10:30").success).toBe(true);
    expect(localDateTime.safeParse("2026-02-30T10:30").success).toBe(false);
    expect(localDateTime.safeParse("2026-10-13").success).toBe(false);
    expect(timeZone.parse(undefined)).toBe("UTC");
    expect(timeZone.parse("")).toBe("UTC");
    expect(timeZone.parse("Europe/Madrid")).toBe("Europe/Madrid");
    expect(timeZone.safeParse("Mars/Olympus").success).toBe(false);
    expect(isTimeZone("Asia/Tokyo")).toBe(true);
  });
});
