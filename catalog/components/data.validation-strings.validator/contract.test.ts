import { describe, expect, it } from "vitest";
import validator from "validator";
describe("validator contract", () => {
  it("validates common string formats", () => {
    expect(validator.isEmail("a@b.co")).toBe(true);
    expect(validator.isURL("https://example.com")).toBe(true);
    expect(validator.isIBAN("ES9121000418450200051332")).toBe(true);
    expect(validator.escape("<b>")).toBe("&lt;b&gt;");
  });
});
