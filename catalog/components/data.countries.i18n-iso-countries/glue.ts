import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import es from "i18n-iso-countries/langs/es.json";

countries.registerLocale(en);
countries.registerLocale(es);

export type CountryLang = "en" | "es";

/** True for an ISO 3166-1 alpha-2 code ("ES", "us"); use it to validate country fields on the server. */
export function isCountryCode(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code) && countries.isValid(code.toUpperCase());
}

/** Localised country name, or null for an unknown code. */
export function countryName(code: string, lang: CountryLang = "en"): string | null {
  return isCountryCode(code) ? (countries.getName(code.toUpperCase(), lang) ?? null) : null;
}

/** Options for a country select, sorted by name in the given language. */
export function countryOptions(lang: CountryLang = "en"): { code: string; name: string }[] {
  return Object.entries(countries.getNames(lang, { select: "official" }))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}
