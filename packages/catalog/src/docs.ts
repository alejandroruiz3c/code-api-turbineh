import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { guideErrors, readGuides } from "./guide.js";

/**
 * Component documentation standard (ADR-0032 §Documentation, format of ADR-0033): every component has a `guide.yaml`
 * (turbineh.guide/v0.1). Hand-written guides win; otherwise the intake documentation step (`pnpm catalog:document`)
 * writes one from the code, manifest, tests and README — facts from code, narrative drafted by our open model and
 * checked against those facts — and records what it generated under `generated`. Read by the decider (compact card,
 * opt-in), `turbineh search`, `/v1/capabilities`, the catalogue index and apps (docs/components/*.md).
 */
export const DOCS_SCHEMA = "turbineh.guide/v0.1";

const text = z.string().min(3).max(1200);
const list = (min: number, max: number) => z.array(text).min(min).max(max);

export const componentDocsSchema = z.object({
  schema: z.literal(DOCS_SCHEMA),
  component: z.string(),
  part: z.string().optional(),
  title: z.string().min(3).max(200),
  summary: z.string().min(10).max(1500),
  keywords: z.array(z.string().min(2).max(60)).min(5).max(40),
  synonyms: z.record(z.string(), z.array(z.string())).optional(),
  use_cases: list(2, 10),
  use_when: list(1, 8),
  avoid_when: list(1, 8),
  tradeoffs: z
    .array(z.object({ choice: text, gain: text, cost: text }))
    .min(1)
    .max(8),
  /** What the code reads: env vars, install line, options. */
  config: z
    .array(z.object({ name: z.string().min(1), default: z.string().optional(), description: text }))
    .min(1),
  /** Exports and routes that exist in the code, with their real signatures. */
  interfaces: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        signature: z.string().min(1),
        where: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
  extension_points: z
    .array(z.object({ what: text, where: z.string().min(1), how: text }))
    .min(1)
    .max(10),
  compatibility: z.record(z.string(), z.unknown()),
  security: list(1, 10),
  /** Each guarantee names the test that proves it: "<file> › <title>". */
  guarantees: z
    .array(z.object({ claim: text, test: z.string().min(3) }))
    .min(1)
    .max(20),
  limits: list(1, 10),
  example: z.string().min(10).max(3000),
  /** Request parameters of a parameterised component (ADR-0040): app file, JSON Schema, fields in words. */
  params: z
    .object({
      file: z.string().min(5),
      schema: z.string().min(5),
      fields: z
        .array(
          z.object({ name: z.string().min(1), description: text, default: z.string().optional() }),
        )
        .min(1)
        .max(40),
      example: z.string().max(4000).optional(),
    })
    .optional(),
  /** Provenance of a generated guide: model, date, generated sections and the checks done by code. */
  generated: z
    .object({
      by: z.string(),
      at: z.string(),
      sections: z.array(z.string()),
      checked: z.array(z.string()),
    })
    .optional(),
});
export type ComponentDocs = z.infer<typeof componentDocsSchema>;

/** The component's main guide (not a part), validated against the standard, or null. */
export function readDocs(componentDir: string): ComponentDocs | null {
  const [g] = readGuides(componentDir).filter((x) => !x.part);
  if (!g) return null;
  const r = componentDocsSchema.safeParse(g);
  return r.success ? r.data : null;
}

/** Completeness: missing or incomplete docs mean "document it" (pnpm catalog:document <id>), never "reject". */
export function docsIssues(componentDir: string, id: string): string[] {
  if (!existsSync(join(componentDir, "guide.yaml")))
    return [`no guide.yaml — document it: pnpm catalog:document ${id}`];
  const [g] = readGuides(componentDir).filter((x) => !x.part);
  const r = componentDocsSchema.safeParse(g);
  const issues = r.success
    ? []
    : [
        `guide.yaml incomplete (${r.error.issues
          .slice(0, 4)
          .map((i) => i.path.join(".") || "/")
          .join(", ")}) — document it: pnpm catalog:document ${id}`,
      ];
  return [...issues, ...guideErrors(componentDir, id)];
}

/**
 * Compact card for the decider: what it does, its main use cases and what it provides. Only positive, discriminating
 * facts: limits and "avoid when" read as risk to the risk question and lowered selection quality on the selection
 * bench (bench/results/*-selection-*.json); they stay in the full guide, search and the index.
 */
export function decisionCard(d: ComponentDocs, provides: string[], does?: string): string {
  const parts = [
    `${(does ?? d.title).replace(/\.$/, "")}.`,
    `Use cases: ${d.use_cases.slice(0, 2).join("; ").replace(/\.$/, "")}.`,
    `Provides: ${provides.join(", ")}.`,
  ];
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 600);
}
