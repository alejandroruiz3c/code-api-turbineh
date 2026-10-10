import { describe, expect, it } from "vitest";
import { addDays, differenceInCalendarDays, format, isBefore, parseISO } from "date-fns";
describe("date-fns contract", () => {
  it("adds, compares and formats dates", () => {
    const d = parseISO("2026-10-13T10:00:00Z");
    expect(differenceInCalendarDays(addDays(d, 7), d)).toBe(7);
    expect(isBefore(d, addDays(d, 1))).toBe(true);
    expect(format(new Date(2026, 9, 13), "yyyy-MM-dd")).toBe("2026-10-13");
  });
});
