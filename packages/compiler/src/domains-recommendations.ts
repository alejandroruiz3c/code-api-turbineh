import { z } from "zod";
import type { DomainSelection } from "./domains.js";

/**
 * Conversational recommendations over the client's own catalogue (component ai.recommendations.turbineh, ADR-0072):
 * detected and parameterised from the request by code. A request is about recommendations when an assistant matches
 * catalogue records to what a person wants (budget, location, needs) — "recommends matching homes", "suggests cars
 * that fit the budget". What the request does not say is a documented default (assumptions), never an invented fact.
 */
const noun = z.object({ singular: z.string().min(1).max(40), plural: z.string().min(1).max(40) });
export const recommendationParamsSchema = z.object({
  item: noun,
  customer: noun,
  currency: z.string().regex(/^[A-Z]{3}$/),
  fields: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
        label: z.string().min(1).max(40),
        type: z.enum(["integer", "number", "text", "enum"]),
        options: z.array(z.string().min(1).max(40)).min(2).max(20).optional(),
        match: z.enum(["min", "max", "equals"]),
      }),
    )
    .max(12),
  maxResults: z.number().int().min(1).max(20),
});
export type RecommendationParams = z.infer<typeof recommendationParamsSchema>;

/** Recommending, suggesting or matching records to a person (the function this component proves). */
const RECOMMEND =
  /\b(?:recommend\w*|suggest\w*|match(?:es|ing)?|find (?:the )?(?:right|best|matching|suitable))\b/i;
/** What makes it a preference match: a budget, a location, needs or a side-by-side comparison. */
const PREFERENCES =
  /\b(?:budget|price range|afford\w*|preferences?|needs|requirements|preferred (?:location|area|town|city)|location|compar\w*|bedrooms?)\b/i;

/** Catalogue nouns: the request's words → singular, plural, and the attribute set they come with. */
const NOUNS: [RegExp, string, string, "property" | null][] = [
  [
    /\b(?:properties|property|homes?|houses?|flats?|apartments?|new[- ]builds?|villas?|real estate)\b/i,
    "property",
    "properties",
    "property",
  ],
  [/\b(?:cars?|vehicles?)\b/i, "car", "cars", null],
  [/\b(?:courses?)\b/i, "course", "courses", null],
  [/\b(?:wines?)\b/i, "wine", "wines", null],
  [/\b(?:laptops?|computers?)\b/i, "laptop", "laptops", null],
  [/\b(?:products?)\b/i, "product", "products", null],
];

const CUSTOMERS: [RegExp, string, string][] = [
  [/\bbuyers?\b/i, "buyer", "buyers"],
  [/\btenants?\b|\brenters?\b/i, "tenant", "tenants"],
  [/\bstudents?\b/i, "student", "students"],
  [/\bguests?\b/i, "guest", "guests"],
  [/\bclients?\b/i, "client", "clients"],
];

const CURRENCIES: [RegExp, string][] = [
  [/€|\beur\b|\beuros?\b|\bspain\b|\bportugal\b|\bfrance\b|\bitaly\b|\bgermany\b/i, "EUR"],
  [/£|\bgbp\b|\bpounds?\b|\bunited kingdom\b/i, "GBP"],
  [/\$|\busd\b|\bdollars?\b/i, "USD"],
];

/** Attributes of a property catalogue: what buyers ask for besides price and location. */
const PROPERTY_FIELDS: RecommendationParams["fields"] = [
  { key: "bedrooms", label: "Bedrooms", type: "integer", match: "min" },
  { key: "bathrooms", label: "Bathrooms", type: "integer", match: "min" },
  { key: "area", label: "Area (m²)", type: "number", match: "min" },
];

const cap = (s: string) => (s ? (s[0] ?? "").toUpperCase() + s.slice(1) : s);
const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(cap)
    .join("");

/** The recommendations domain of a request (deterministic), or null when it is not about one. */
export function extractRecommendationParams(
  prompt: string,
  _appName?: string,
): DomainSelection | null {
  const text = prompt.replace(/\s+/g, " ");
  // Recommending and what it matches on in the same sentence: "suggests a reply" or "matches the brand colour"
  // elsewhere never make a catalogue recommender.
  const sentences = text.split(/(?<=[.!?;])\s+/);
  const found = NOUNS.find(([re]) =>
    sentences.some((s) => RECOMMEND.test(s) && re.test(s) && PREFERENCES.test(text)),
  );
  if (!found) return null;
  const assumptions: string[] = [];
  const [, singular, plural, kind] = found;
  const customer = CUSTOMERS.find(([re]) => re.test(text));
  if (!customer) assumptions.push("Who asks not stated: customers.");
  const currency = CURRENCIES.find(([re]) => re.test(text))?.[1];
  if (!currency) assumptions.push("Currency not stated: EUR.");
  const fields = kind === "property" ? PROPERTY_FIELDS : [];
  assumptions.push(
    fields.length
      ? `Attributes besides price and location: ${fields.map((f) => f.label.toLowerCase()).join(", ")} (edit src/recommendations/params.json).`
      : "No attributes besides price and location stated: add them in src/recommendations/params.json.",
    "Only records staff mark as verified are recommended.",
  );
  const params = recommendationParamsSchema.parse({
    item: { singular, plural },
    customer: customer
      ? { singular: customer[1], plural: customer[2] }
      : { singular: "customer", plural: "customers" },
    currency: currency ?? "EUR",
    fields,
    maxResults: 5,
  });
  const Item = pascal(singular);
  return {
    id: "recommendations",
    capability: "ai.recommendations",
    component: "ai.recommendations.turbineh",
    recipes: ["ai-agents"],
    paramsFile: "src/recommendations/params.json",
    params: params as unknown as Record<string, unknown>,
    providedEntities: [
      Item,
      `${Item}Listing`,
      "Listing",
      "CatalogItem",
      "Recommendation",
      "Preference",
      "Preferences",
      "BuyerProfile",
      "CustomerProfile",
      "UserProfile",
      "Profile",
      "SearchProfile",
      "SavedSearch",
      `Saved${Item}`,
      "Comparison",
      `${Item}Comparison`,
      "Viewing",
      "ViewingAppointment",
      "ViewingRequest",
      "Lead",
    ],
    assumptions,
  };
}
