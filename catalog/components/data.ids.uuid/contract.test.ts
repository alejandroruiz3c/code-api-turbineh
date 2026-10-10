import { describe, expect, it } from "vitest";
import { v4, v7, validate, version } from "uuid";
describe("uuid contract", () => {
  it("generates and validates v4 and v7", () => {
    expect(validate(v4())).toBe(true);
    expect(version(v7())).toBe(7);
    expect(validate("not-a-uuid")).toBe(false);
  });
});
