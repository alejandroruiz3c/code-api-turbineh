import { z } from "zod";
import type { RecommendationConfig } from "./config";

/**
 * Deterministic search, ranking and comparison over the client's own catalogue (component ai.recommendations.turbineh).
 * Pure functions: the same records and preferences always give the same answer, and only records passed in (rows
 * of the database) are ever returned — nothing is invented. Only verified, active records are eligible.
 */
export type AttributeValue = string | number;

export interface CatalogItem {
  reference: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  location: string;
  attributes: Record<string, AttributeValue | null>;
  verified: boolean;
  active: boolean;
}

export interface Preferences {
  /** Highest price the person accepts (same currency as the catalogue). */
  budgetMax: number | null;
  /** Place the person prefers (town, area, region); matched accent- and case-insensitively. */
  location: string | null;
  /** Needs per attribute key (bedrooms: 3, type: "house"). */
  needs: Record<string, AttributeValue>;
}

export const EMPTY_PREFERENCES: Preferences = { budgetMax: null, location: null, needs: {} };

/** References are short codes staff give each record (R-101, CASA-12). */
export const REFERENCE = /^[A-Z0-9][A-Z0-9-]{1,23}$/;
export const referenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(REFERENCE, "references look like R-101");

/** "València " → "valencia": lower case, no accents, single spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Zod schema of one need per configured field (numbers for integer/number fields, an option for enums). */
function needSchema(f: RecommendationConfig["fields"][number]): z.ZodType<AttributeValue> {
  if (f.type === "integer") return z.coerce.number().int().min(0).max(1_000_000);
  if (f.type === "number") return z.coerce.number().min(0).max(1_000_000_000);
  if (f.type === "enum" && f.options) {
    const [first, ...rest] = f.options;
    return z.enum([first as string, ...rest] as [string, ...string[]]);
  }
  return z.string().trim().min(1).max(80);
}

/** Preferences as the assistant records them (validated: unknown keys and wrong types are refused). */
export function preferencesSchema(cfg: RecommendationConfig) {
  return z
    .object({
      budgetMax: z.coerce.number().positive().max(1_000_000_000).optional(),
      location: z.string().trim().min(2).max(120).optional(),
      needs: z
        .object(Object.fromEntries(cfg.fields.map((f) => [f.key, needSchema(f).optional()])))
        .strict()
        .optional(),
    })
    .strict();
}

/** Merges newly stated preferences into what the person said before (a later statement wins). */
export function mergePreferences(
  before: Preferences,
  stated: z.infer<ReturnType<typeof preferencesSchema>>,
): Preferences {
  const needs = { ...before.needs };
  for (const [k, v] of Object.entries(stated.needs ?? {}))
    if (v !== undefined) needs[k] = v as AttributeValue;
  return {
    budgetMax: stated.budgetMax ?? before.budgetMax,
    location: stated.location ?? before.location,
    needs,
  };
}

/** Attribute values staff enter for a record, validated against the configured fields. */
export function attributesSchema(cfg: RecommendationConfig) {
  return z
    .object(Object.fromEntries(cfg.fields.map((f) => [f.key, needSchema(f).nullable().optional()])))
    .strict();
}

/** Why a record does not fit the preferences (empty = it fits). */
export function unmet(item: CatalogItem, prefs: Preferences, cfg: RecommendationConfig): string[] {
  const why: string[] = [];
  if (!item.verified || !item.active) why.push("not verified");
  if (prefs.budgetMax !== null && item.price > prefs.budgetMax) why.push("over budget");
  if (prefs.location && !normalizeText(item.location).includes(normalizeText(prefs.location)))
    why.push("other location");
  for (const f of cfg.fields) {
    const want = prefs.needs[f.key];
    if (want === undefined) continue;
    const have = item.attributes[f.key];
    if (have === null || have === undefined) {
      why.push(`${f.label} unknown`);
      continue;
    }
    if (f.match === "min" && Number(have) < Number(want)) why.push(`${f.label} below need`);
    if (f.match === "max" && Number(have) > Number(want)) why.push(`${f.label} above need`);
    if (f.match === "equals" && normalizeText(String(have)) !== normalizeText(String(want)))
      why.push(`${f.label} differs`);
  }
  return why;
}

/**
 * The records that fit every stated preference, best first: verified and active only; within budget; in the
 * preferred location; meeting every need. Order: lowest price first, then reference (stable). At most `limit`.
 */
export function rankItems(
  items: readonly CatalogItem[],
  prefs: Preferences,
  cfg: RecommendationConfig,
  limit = cfg.maxResults,
): CatalogItem[] {
  return items
    .filter((i) => unmet(i, prefs, cfg).length === 0)
    .sort((a, b) => a.price - b.price || a.reference.localeCompare(b.reference))
    .slice(0, Math.max(1, limit));
}

/** "320000" + "EUR" → "320,000 EUR" (fixed locale: the same text on every server). */
export function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(amount)} ${currency}`;
}

const show = (v: AttributeValue | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/** The verified facts of one record, one line per attribute, in the configured order. */
export function facts(
  item: CatalogItem,
  cfg: RecommendationConfig,
): { label: string; value: string }[] {
  return [
    { label: "Price", value: formatMoney(item.price, item.currency) },
    { label: "Location", value: item.location },
    ...cfg.fields.map((f) => ({ label: f.label, value: show(item.attributes[f.key]) })),
  ];
}

/** Side-by-side comparison: one row per attribute, one column per record (in the order asked). */
export function compareRows(
  items: readonly CatalogItem[],
  cfg: RecommendationConfig,
): { head: string[]; rows: { label: string; values: string[] }[] } {
  const per = items.map((i) => facts(i, cfg));
  return {
    head: items.map((i) => `${i.reference} · ${i.title}`),
    rows: (per[0] ?? []).map((row, r) => ({
      label: row.label,
      values: per.map((p) => p[r]?.value ?? "—"),
    })),
  };
}

/** The comparison as plain text for the chat ("Price: 300,000 EUR | 285,000 EUR"). */
export function compareText(items: readonly CatalogItem[], cfg: RecommendationConfig): string {
  const t = compareRows(items, cfg);
  return [t.head.join(" | "), ...t.rows.map((r) => `${r.label}: ${r.values.join(" | ")}`)].join(
    "\n",
  );
}

/** Public link to the side-by-side page. */
export const compareLink = (refs: readonly string[]) =>
  `/compare?refs=${refs.map(encodeURIComponent).join(",")}`;
