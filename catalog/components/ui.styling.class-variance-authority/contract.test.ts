import { describe, expect, it } from "vitest";
import { cva } from "class-variance-authority";
describe("class-variance-authority contract", () => {
  it("composes variant classes", () => {
    const button = cva("btn", {
      variants: { size: { sm: "text-sm", lg: "text-lg" } },
      defaultVariants: { size: "sm" },
    });
    expect(button()).toBe("btn text-sm");
    expect(button({ size: "lg" })).toBe("btn text-lg");
  });
});
