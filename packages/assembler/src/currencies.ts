import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";

/** Words and symbols → ISO 4217 code. Only unambiguous ones: "$" alone is not taken as USD. */
const CURRENCY_WORDS: [RegExp, string][] = [
  [/\b(eur|euros?)\b|€/i, "eur"],
  [/\b(usd|us dollars?|u\.s\. dollars?|dollars?|dólares?)\b|us\$/i, "usd"],
  [/\b(gbp|pounds? sterling|british pounds?|libras?)\b|£/i, "gbp"],
  [/\b(chf|swiss francs?)\b/i, "chf"],
  [/\b(mxn|mexican pesos?)\b/i, "mxn"],
  [/\b(cad|canadian dollars?)\b/i, "cad"],
  [/\b(aud|australian dollars?)\b/i, "aud"],
  [/\b(jpy|japanese yen|yen)\b|¥/i, "jpy"],
];

/**
 * Currencies the request names, in order of first mention (deterministic, no model): the first one becomes the base
 * currency, the rest the extra currencies buyers can choose. Canadian/Australian dollars are not counted as USD.
 */
export function requestedCurrencies(text: string): string[] {
  const hits: { code: string; at: number }[] = [];
  for (const [re, code] of CURRENCY_WORDS) {
    const scrubbed =
      code === "usd" ? text.replace(/\b(canadian|australian)\s+dollars?\b/gi, " ") : text;
    const m = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`).exec(
      scrubbed,
    );
    if (m) hits.push({ code, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.code);
}

/** Storefront apps: sets SHOP_CURRENCY / SHOP_CURRENCIES in .env.example from the request (only when it names any). */
export function applyRequestedCurrencies(outDir: string, spec: BuildSpec): string[] {
  const file = join(outDir, ".env.example");
  if (!existsSync(file)) return [];
  const env = readFileSync(file, "utf8");
  if (!/^SHOP_CURRENCY=/m.test(env)) return [];
  const text = [spec.summary, ...spec.acceptance_criteria].join("\n");
  const [base, ...extra] = requestedCurrencies(text);
  if (!base) return [];
  writeFileSync(
    file,
    env
      .replace(/^SHOP_CURRENCY=.*$/m, `SHOP_CURRENCY=${base}`)
      .replace(/^SHOP_CURRENCIES=.*$/m, `SHOP_CURRENCIES=${extra.join(",")}`),
  );
  return [base, ...extra];
}
