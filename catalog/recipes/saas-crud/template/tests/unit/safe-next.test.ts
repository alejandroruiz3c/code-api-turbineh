import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("redirect after sign-in", () => {
  it("only goes back to a path of this site, never to another origin", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
    expect(safeNext("/dashboard?x=1")).toBe("/dashboard?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "evil", "", null, 3])
      expect(safeNext(bad)).toBeNull();
  });
});
