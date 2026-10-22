import { z } from "zod";
import params from "./params.json";

/**
 * Recommendation parameters (component ai.recommendations.turbineh, ADR-0072). params.json is written by TurbineH from
 * the request: what the catalogue holds (property, car, course…), who asks (buyer, customer…), the currency, and the
 * attributes a person can ask for besides price and location. Validated at start-up: a wrong value fails loudly.
 */
const noun = z.object({
  singular: z.string().trim().min(1).max(40),
  plural: z.string().trim().min(1).max(40),
});

export const FieldDef = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    label: z.string().trim().min(1).max(40),
    type: z.enum(["integer", "number", "text", "enum"]),
    options: z.array(z.string().trim().min(1).max(40)).min(2).max(20).optional(),
    match: z.enum(["min", "max", "equals"]),
  })
  .superRefine((f, ctx) => {
    if (f.type === "enum" && !f.options)
      ctx.addIssue({ code: "custom", path: ["options"], message: "enum fields need options" });
    if ((f.type === "text" || f.type === "enum") && f.match !== "equals")
      ctx.addIssue({
        code: "custom",
        path: ["match"],
        message: "text and enum fields match by equals",
      });
  });
export type FieldDef = z.infer<typeof FieldDef>;

export const RecommendationParams = z
  .object({
    item: noun,
    customer: noun,
    currency: z.string().regex(/^[A-Z]{3}$/),
    fields: z.array(FieldDef).max(12),
    maxResults: z.number().int().min(1).max(20),
  })
  .superRefine((p, ctx) => {
    const keys = p.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", path: ["fields"], message: "field keys must be unique" });
  });
export type RecommendationConfig = z.infer<typeof RecommendationParams>;

export const recommendationConfig: RecommendationConfig = RecommendationParams.parse(params);
