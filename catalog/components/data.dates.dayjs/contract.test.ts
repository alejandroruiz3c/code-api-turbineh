import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
describe("dayjs contract", () => {
  it("is immutable and formats", () => {
    const a = dayjs("2026-10-13");
    const b = a.add(1, "month");
    expect(a.format("YYYY-MM-DD")).toBe("2026-10-13");
    expect(b.format("YYYY-MM-DD")).toBe("2026-11-13");
    expect(b.diff(a, "day")).toBe(31);
  });
});
