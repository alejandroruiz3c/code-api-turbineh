import { describe, expect, it } from "vitest";
import { LINKS } from "./product-nav";

describe("product navigation", () => {
  it("has the catalogue as its own item, next to Discover", () => {
    const hrefs = LINKS.map((l) => l.href);
    expect(hrefs.indexOf("/catalog")).toBe(hrefs.indexOf("/discover") + 1);
    expect(LINKS.find((l) => l.href === "/catalog")?.label).toBe("Catalogue");
  });

  it("keeps How to use, and every item stays inside the product", () => {
    expect(LINKS.map((l) => l.href)).toContain("/use");
    for (const l of LINKS) expect(l.href).toMatch(/^\/[a-z]/);
  });
});
