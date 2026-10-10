import { describe, expect, it } from "vitest";
import { diffLines } from "diff";
describe("diff contract", () => {
  it("reports added and removed lines", () => {
    const parts = diffLines("a\nb\n", "a\nc\n");
    expect(parts.filter((p) => p.added).map((p) => p.value)).toEqual(["c\n"]);
    expect(parts.filter((p) => p.removed).map((p) => p.value)).toEqual(["b\n"]);
  });
});
