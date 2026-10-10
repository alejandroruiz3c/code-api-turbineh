import { describe, expect, it } from "vitest";
import slugify from "slugify";
describe("slugify contract", () => {
  it("creates lowercase strict slugs", () => {
    expect(slugify("Café Niño & Co!", { lower: true, strict: true })).toBe("cafe-nino-and-co");
  });
});
