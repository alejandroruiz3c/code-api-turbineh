import { describe, expect, it } from "vitest";
import { overlaps, parseClock, slotProblem, withinAvailability } from "@/server/bookings";

const at = (iso: string) => new Date(`${iso}Z`);
const slot = (a: string, b: string) => ({ start: at(a), end: at(b) });

describe("booking rules", () => {
  it("treats touching bookings as not overlapping", () => {
    expect(
      overlaps(
        slot("2030-01-07T09:00", "2030-01-07T10:00"),
        slot("2030-01-07T10:00", "2030-01-07T11:00"),
      ),
    ).toBe(false);
    expect(
      overlaps(
        slot("2030-01-07T09:00", "2030-01-07T10:30"),
        slot("2030-01-07T10:00", "2030-01-07T11:00"),
      ),
    ).toBe(true);
  });

  it("requires the whole booking inside an availability window of that weekday", () => {
    const monday9to17 = [{ weekday: 1, startMinute: 540, endMinute: 1020 }]; // 2030-01-07 is a Monday
    expect(withinAvailability(slot("2030-01-07T09:00", "2030-01-07T10:00"), monday9to17)).toBe(
      true,
    );
    expect(withinAvailability(slot("2030-01-07T16:30", "2030-01-07T17:30"), monday9to17)).toBe(
      false,
    );
    expect(withinAvailability(slot("2030-01-08T09:00", "2030-01-08T10:00"), monday9to17)).toBe(
      false,
    );
  });

  it("rejects past, too short and too long bookings", () => {
    const now = at("2030-01-01T00:00");
    expect(slotProblem(slot("2029-12-31T09:00", "2029-12-31T10:00"), now)).toMatch(/future/);
    expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T09:05"), now)).toMatch(/at least/);
    expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T18:00"), now)).toMatch(/at most/);
    expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T10:00"), now)).toBeNull();
  });

  it("parses opening hours", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("24:00")).toBeNull();
  });
});
