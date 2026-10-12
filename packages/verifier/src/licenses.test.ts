import { describe, expect, it } from "vitest";
import { licenseBlocks } from "./verify.js";

describe("dependency licence policy (SPDX)", () => {
  it("blocks copyleft and unknown licences", () => {
    expect(licenseBlocks("GPL-3.0-only")).toBe(true);
    expect(licenseBlocks("LGPL-3.0-or-later")).toBe(true);
    expect(licenseBlocks("UNLICENSED")).toBe(true);
    expect(licenseBlocks("MIT")).toBe(false);
  });

  it("lets a dual licence be used under its permissive option", () => {
    expect(licenseBlocks("MIT OR GPL-3.0-or-later")).toBe(false);
    expect(licenseBlocks("(GPL-2.0 OR LGPL-3.0)")).toBe(true);
  });

  it("blocks a conjunction when any part is copyleft", () => {
    expect(licenseBlocks("MIT AND GPL-3.0-only")).toBe(true);
    expect(licenseBlocks("MIT AND BSD-3-Clause")).toBe(false);
  });

  it("respects parentheses and precedence, and blocks what it cannot read", () => {
    expect(licenseBlocks("(MIT OR GPL-3.0-only) AND LGPL-3.0-only")).toBe(true);
    expect(licenseBlocks("MIT OR GPL-3.0-only AND LGPL-3.0-only")).toBe(false);
    expect(licenseBlocks("(MIT AND BSD-3-Clause) OR GPL-2.0")).toBe(false);
    expect(licenseBlocks("GPL-2.0-only WITH Classpath-exception-2.0")).toBe(true);
    expect(licenseBlocks("MIT OR")).toBe(true);
    expect(licenseBlocks("(MIT")).toBe(true);
  });
});
