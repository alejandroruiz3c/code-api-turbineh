import { describe, expect, it } from "vitest";
import { createId, isCuid } from "@paralleldrive/cuid2";
describe("cuid2 contract", () => {
  it("creates unique, valid ids", () => {
    const a = createId();
    expect(isCuid(a)).toBe(true);
    expect(a).not.toBe(createId());
  });
});
