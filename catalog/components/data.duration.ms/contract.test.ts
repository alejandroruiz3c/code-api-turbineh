import { describe, expect, it } from "vitest";
import ms from "ms";
describe("ms contract", () => {
  it("parses and formats durations", () => {
    expect(ms("2h")).toBe(7_200_000);
    expect(ms(60_000)).toBe("1m");
  });
});
