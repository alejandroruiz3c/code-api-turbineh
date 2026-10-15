import { describe, expect, it } from "vitest";
import * as CookieConsent from "vanilla-cookieconsent";
describe("vanilla-cookieconsent contract", () => {
  it("exposes the consent API", () => {
    expect(typeof CookieConsent.run).toBe("function");
    expect(typeof CookieConsent.acceptedCategory).toBe("function");
  });
});
