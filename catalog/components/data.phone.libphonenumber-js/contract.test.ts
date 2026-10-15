import { describe, expect, it } from "vitest";
import { parsePhoneNumberFromString } from "libphonenumber-js";
describe("libphonenumber-js contract", () => {
  it("validates and formats E.164", () => {
    const n = parsePhoneNumberFromString("+34 612 34 56 78");
    expect(n?.isValid()).toBe(true);
    expect(n?.format("E.164")).toBe("+34612345678");
    expect(parsePhoneNumberFromString("123")?.isValid() ?? false).toBe(false);
  });
});
