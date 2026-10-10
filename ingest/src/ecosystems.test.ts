import { describe, expect, it } from "vitest";
import { packageCard, type EcosystemsPackage } from "./ecosystems.js";

describe("packageCard", () => {
  it("joins name, description and at most 15 keywords", () => {
    const p = {
      name: "zod",
      description: "Schema validation",
      keywords_array: Array.from({ length: 20 }, (_, i) => `k${i}`),
    } as EcosystemsPackage;
    const card = packageCard(p);
    expect(card.startsWith("zod — Schema validation — keywords: k0")).toBe(true);
    expect(card).not.toContain("k15");
  });
});
