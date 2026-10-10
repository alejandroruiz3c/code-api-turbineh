import { describe, expect, it } from "vitest";
import { productionClosure } from "./verify.js";

describe("productionClosure", () => {
  it("follows production dependencies through snapshots and ignores dev-only packages", () => {
    const closure = productionClosure({
      importers: { ".": { dependencies: { next: { version: "16.3.8(react@19.3.0)" } } } },
      snapshots: {
        "next@16.3.8(react@19.3.0)": { dependencies: { "@next/env": "16.3.8" } },
        "@next/env@16.3.8": {},
        "braces@3.0.3": {},
      },
    });
    expect([...closure].sort()).toEqual(["@next/env@16.3.8", "next@16.3.8"]);
    expect(closure.has("braces@3.0.3")).toBe(false);
  });
});
