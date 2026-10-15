import { describe, expect, it } from "vitest";
import readingTime from "reading-time";
describe("reading-time contract", () => {
  it("estimates minutes from words", () => {
    const r = readingTime("word ".repeat(400));
    expect(r.words).toBe(400);
    expect(Math.round(r.minutes)).toBe(2);
  });
});
