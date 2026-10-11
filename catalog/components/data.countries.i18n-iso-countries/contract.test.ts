import { describe, expect, it } from "vitest";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
describe("i18n-iso-countries contract", () => {
  it("returns localised country names from ISO codes", () => {
    countries.registerLocale(en);
    expect(countries.getName("ES", "en")).toBe("Spain");
    expect(countries.isValid("XX")).toBe(false);
  });
});
