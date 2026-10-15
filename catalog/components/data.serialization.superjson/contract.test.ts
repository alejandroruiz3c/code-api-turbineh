import { describe, expect, it } from "vitest";
import superjson from "superjson";
describe("superjson contract", () => {
  it("round-trips dates and maps", () => {
    const v = { at: new Date("2026-10-13T00:00:00Z"), m: new Map([["a", 1]]) };
    const back = superjson.parse<typeof v>(superjson.stringify(v));
    expect(back.at instanceof Date).toBe(true);
    expect(back.m.get("a")).toBe(1);
  });
});
