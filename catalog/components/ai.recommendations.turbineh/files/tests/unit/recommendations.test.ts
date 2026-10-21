import { describe, expect, it } from "vitest";
import { RecommendationParams, recommendationConfig } from "@/recommendations/config";
import {
  attributesSchema,
  compareRows,
  compareText,
  mergePreferences,
  normalizeText,
  preferencesSchema,
  rankItems,
  unmet,
  type CatalogItem,
} from "@/recommendations/search";

// A fixed configuration (independent of this app's params.json): homes with bedrooms (at least) and a type.
const cfg = RecommendationParams.parse({
  item: { singular: "home", plural: "homes" },
  customer: { singular: "buyer", plural: "buyers" },
  currency: "EUR",
  fields: [
    { key: "bedrooms", label: "Bedrooms", type: "integer", match: "min" },
    { key: "kind", label: "Type", type: "enum", options: ["flat", "house"], match: "equals" },
  ],
  maxResults: 5,
});

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  reference: "H-1",
  title: "Home",
  description: "",
  price: 300_000,
  currency: "EUR",
  location: "Valencia",
  attributes: { bedrooms: 3, kind: "flat" },
  verified: true,
  active: true,
  ...over,
});

const catalogue = [
  item({ reference: "H-3", price: 310_000 }),
  item({ reference: "H-1", price: 280_000, location: "València, Ruzafa" }),
  item({ reference: "H-2", price: 280_000 }),
  item({ reference: "H-4", price: 450_000 }), // over budget
  item({ reference: "H-5", price: 250_000, verified: false }), // not verified
  item({ reference: "H-6", price: 200_000, location: "Murcia" }), // other location
  item({ reference: "H-7", price: 260_000, attributes: { bedrooms: 1, kind: "flat" } }), // too small
  item({ reference: "H-8", price: 270_000, active: false }), // withdrawn
  item({ reference: "H-9", price: 265_000, attributes: { bedrooms: 3, kind: "house" } }), // other type
];

describe("recommendations (component ai.recommendations.turbineh)", () => {
  it("validates this app's parameters and refuses inconsistent ones", () => {
    expect(RecommendationParams.safeParse(recommendationConfig).success).toBe(true);
    expect(
      RecommendationParams.safeParse({
        ...cfg,
        fields: [{ key: "kind", label: "Type", type: "enum", match: "equals" }],
      }).success,
      "an enum field needs its options",
    ).toBe(false);
    expect(
      RecommendationParams.safeParse({ ...cfg, fields: [cfg.fields[0], cfg.fields[0]] }).success,
      "field keys are unique",
    ).toBe(false);
  });

  it("records only valid preferences: budget, location and needs of the configured fields", () => {
    const schema = preferencesSchema(cfg);
    expect(
      schema.safeParse({ budgetMax: 320000, location: "Valencia", needs: { bedrooms: 2 } }).success,
    ).toBe(true);
    expect(schema.safeParse({ needs: { garage: 1 } }).success, "unknown need").toBe(false);
    expect(schema.safeParse({ needs: { kind: "castle" } }).success, "not an option").toBe(false);
    expect(schema.safeParse({ budgetMax: -5 }).success, "negative budget").toBe(false);
    const first = mergePreferences(
      { budgetMax: null, location: null, needs: {} },
      { budgetMax: 320000, needs: { bedrooms: 2 } },
    );
    const later = mergePreferences(first, { location: "Valencia", needs: { bedrooms: 3 } });
    expect(later, "later statements win, earlier ones are kept").toEqual({
      budgetMax: 320000,
      location: "Valencia",
      needs: { bedrooms: 3 },
    });
    expect(attributesSchema(cfg).safeParse({ bedrooms: "2", kind: null }).success).toBe(true);
    expect(attributesSchema(cfg).safeParse({ bedrooms: "two" }).success).toBe(false);
  });

  it("recommends only verified, active records that fit the budget, the location and every need, cheapest first, deterministically", () => {
    const prefs = {
      budgetMax: 320_000,
      location: "valencia",
      needs: { bedrooms: 2, kind: "flat" },
    };
    const refs = rankItems(catalogue, prefs, cfg).map((i) => i.reference);
    expect(refs).toEqual(["H-1", "H-2", "H-3"]);
    expect(
      rankItems([...catalogue].reverse(), prefs, cfg).map((i) => i.reference),
      "same order whatever the input order",
    ).toEqual(refs);
    expect(unmet(catalogue[3] as CatalogItem, prefs, cfg)).toEqual(["over budget"]);
    expect(unmet(catalogue[4] as CatalogItem, prefs, cfg)).toEqual(["not verified"]);
    expect(unmet(catalogue[5] as CatalogItem, prefs, cfg)).toEqual(["other location"]);
    expect(unmet(catalogue[6] as CatalogItem, prefs, cfg)).toEqual(["Bedrooms below need"]);
    expect(
      rankItems(catalogue, { budgetMax: 100, location: null, needs: {} }, cfg),
      "nothing fits: nothing is returned",
    ).toEqual([]);
    expect(rankItems(catalogue, prefs, cfg, 2)).toHaveLength(2);
    expect(normalizeText("  VALÈNCIA  Ruzafa ")).toBe("valencia ruzafa");
  });

  it("compares records side by side with the same facts in the same order", () => {
    const [a, b] = [catalogue[1] as CatalogItem, catalogue[8] as CatalogItem];
    const t = compareRows([a, b], cfg);
    expect(t.head).toEqual(["H-1 · Home", "H-9 · Home"]);
    expect(t.rows.map((r) => r.label)).toEqual(["Price", "Location", "Bedrooms", "Type"]);
    expect(t.rows[0]?.values).toEqual(["280,000 EUR", "265,000 EUR"]);
    expect(t.rows[3]?.values).toEqual(["flat", "house"]);
    expect(compareText([a, b], cfg)).toContain("Price: 280,000 EUR | 265,000 EUR");
  });
});
