import { describe, expect, it } from "vitest";
import {
  assertBookableDay,
  canChange,
  cellsOf,
  dayStarts,
  freeSlots,
  PolicyError,
} from "@/bookings/availability";
import { bookingConfig, BookingParams, priceLabel } from "@/bookings/config";
import { addDays, isoWeekday, localTime, zonedToUtc } from "@/bookings/time";

// A fixed configuration (independent of this app's params.json): weekdays 09:00–19:00 in Madrid, 45-minute slots.
const cfg = BookingParams.parse({
  business: "Test clinic",
  timeZone: "Europe/Madrid",
  resource: { singular: "Therapist", plural: "Therapists", count: 2, names: [] },
  customer: { singular: "patient", plural: "patients" },
  services: [{ name: "Session", minutes: 45, price: 50, currency: "EUR" }],
  slotMinutes: 45,
  hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "19:00" })),
  policy: { cancelNoticeHours: 24, bookingNoticeMinutes: 0, horizonDays: 60 },
  faq: [],
});

describe("booking domain (component domain.bookings.turbineh)", () => {
  it("validates this app's parameters", () => {
    expect(BookingParams.safeParse(bookingConfig).success).toBe(true);
    expect(BookingParams.safeParse({ ...cfg, timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(
      BookingParams.safeParse({ ...cfg, hours: [{ weekday: 1, open: "19:00", close: "09:00" }] })
        .success,
    ).toBe(false);
  });

  it("converts local times to instants across DST (Europe/Madrid)", () => {
    // Winter (UTC+1) and summer (UTC+2).
    expect(zonedToUtc("2026-01-12", "09:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-01-12T08:00:00.000Z",
    );
    expect(zonedToUtc("2026-07-13", "09:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-07-13T07:00:00.000Z",
    );
    // 02:30 does not exist on the spring-forward night; 02:30 on the fall-back night is the first one.
    expect(zonedToUtc("2026-03-29", "02:30", "Europe/Madrid")).toBeNull();
    expect(zonedToUtc("2026-10-25", "02:30", "Europe/Madrid")?.toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("offers every 45-minute start that ends by closing time, in local time", () => {
    const starts = dayStarts("2026-10-26", 45, cfg); // Monday after the DST change
    expect(starts.map((s) => s.time)).toEqual([
      "09:00",
      "09:45",
      "10:30",
      "11:15",
      "12:00",
      "12:45",
      "13:30",
      "14:15",
      "15:00",
      "15:45",
      "16:30",
      "17:15",
      "18:00",
    ]);
    expect(starts[0]?.start.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(localTime(starts[0]!.start, "Europe/Madrid")).toBe("09:00");
    expect(dayStarts("2026-10-24", 45, cfg)).toEqual([]); // Saturday
  });

  it("never offers taken, past or closed times", () => {
    const now = new Date("2026-10-26T09:30:00Z"); // 10:30 in Madrid
    const busy = [
      {
        resourceId: "a",
        start: new Date("2026-10-26T11:00:00Z"),
        end: new Date("2026-10-26T11:45:00Z"),
      },
    ];
    const slots = freeSlots({
      day: "2026-10-26",
      minutes: 45,
      resourceIds: ["a", "b"],
      busy,
      cfg,
      now,
    });
    expect(slots.some((s) => s.time === "10:30")).toBe(false); // already started
    expect(slots.filter((s) => s.time === "12:00").map((s) => s.resourceId)).toEqual(["b"]);
    expect(slots.filter((s) => s.time === "12:45").map((s) => s.resourceId)).toEqual(["a", "b"]);
  });

  it("applies the day policy: format, past, horizon and closed days", () => {
    const now = new Date("2026-10-26T09:30:00Z");
    expect(() => assertBookableDay("26/10/2026", cfg, now)).toThrow(PolicyError);
    expect(() => assertBookableDay("2026-10-23", cfg, now)).toThrow(/past/);
    expect(() => assertBookableDay("2027-06-01", cfg, now)).toThrow(/ahead/);
    expect(() => assertBookableDay("2026-10-31", cfg, now)).toThrow(/closed/);
    expect(() => assertBookableDay(addDays("2026-10-26", 1), cfg, now)).not.toThrow();
    expect(isoWeekday("2026-10-25")).toBe(7);
  });

  it("allows changes only with enough notice (24 h)", () => {
    const start = new Date("2026-10-27T08:00:00Z");
    expect(canChange(start, cfg, new Date("2026-10-26T07:59:00Z"))).toBe(true);
    expect(canChange(start, cfg, new Date("2026-10-26T08:01:00Z"))).toBe(false);
  });

  it("locks every grid cell a booking covers (database-level double-booking guard)", () => {
    const s = new Date("2026-10-26T08:00:00Z");
    expect(cellsOf(s, 45, 45)).toHaveLength(1);
    expect(cellsOf(s, 90, 45).map((d) => d.toISOString())).toEqual([
      "2026-10-26T08:00:00.000Z",
      "2026-10-26T08:45:00.000Z",
    ]);
    expect(priceLabel({ name: "x", minutes: 45, price: 60, currency: "EUR" })).toBe("60 €");
  });
});
