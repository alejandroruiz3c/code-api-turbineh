import { describe, expect, it } from "vitest";
import ical from "ical-generator";
describe("ical-generator contract", () => {
  it("renders a VEVENT", () => {
    const cal = ical({ name: "Bookings" });
    cal.createEvent({
      start: new Date(Date.UTC(2026, 9, 13, 9)),
      end: new Date(Date.UTC(2026, 9, 13, 10)),
      summary: "Physio session",
    });
    const out = cal.toString();
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).toContain("SUMMARY:Physio session");
  });
});
