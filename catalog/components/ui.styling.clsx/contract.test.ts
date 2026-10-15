import { describe, expect, it } from "vitest";
import { clsx } from "clsx";
describe("clsx contract", () => {
  it("joins truthy classes", () => {
    expect(clsx("a", false && "b", { c: true, d: false }, ["e"])).toBe("a c e");
  });
});
