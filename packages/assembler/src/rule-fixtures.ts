import type { BuildSpec } from "@turbineh/compiler";
import { fieldsOf, GENERATED, importedSample, nthOfType, sampleValue } from "./entities.js";
import { camel, entityNames } from "./naming.js";

type Entity = BuildSpec["entities"][number];

/** Raw value formats of the generated create schemas (what a form or CSV row sends). */
const FORMATS: Record<Entity["fields"][number]["type"], string> = {
  string: "text",
  text: "text",
  enum: "text",
  reference: "text (identifier of the referenced record)",
  email: "email address",
  integer: 'integer as a string, e.g. "7"',
  decimal: 'number as a string, e.g. "12.5"',
  boolean: 'checkbox: "on" when true; omit the field when false',
  date: 'date only, exactly "YYYY-MM-DD" (e.g. "2026-10-13"), never a time',
  datetime: 'local date and time "YYYY-MM-DDTHH:mm" (e.g. "2026-10-13T10:30")',
  file: "https URL",
};

/** Where the business rules of one generated entity live (Backup Coder trigger T3, ADR-0023). */
export interface RuleFiles {
  entity: string;
  pascal: string;
  slug: string;
  rules: string;
  schema: string;
  table: string;
  test: string;
  fixtures: string;
  /** Raw form values the app's own end-to-end tests submit (create form and CSV import row). */
  samples: { created: Record<string, string>; imported: Record<string, string> };
  /** Exact raw value format the create schema accepts for each field (given to the Backup Coder). */
  formats: Record<string, string>;
  /** Deterministic test: the rules must accept the app's own end-to-end samples (written by code, never a model). */
  fixturesTest: string;
}

export function ruleFiles(e: Entity): RuleFiles {
  const n = entityNames(e.name);
  const fields = fieldsOf(e);
  const firstText = fields.find((f) => ["string", "text", "enum", "reference"].includes(f.type));
  const created: Record<string, string> = {};
  const imported: Record<string, string> = {};
  const formats: Record<string, string> = {};
  for (const f of fields) {
    formats[camel(f.name)] = `${FORMATS[f.type]}${f.required ? "" : "; optional (omit it)"}`;
    const v = sampleValue(f, n.labelSingular, nthOfType(fields, f));
    if (f.required || f === firstText) created[camel(f.name)] = v;
    imported[camel(f.name)] = f.type === "boolean" ? "true" : importedSample(f, v, "imported");
  }
  const base = `@/entities/${n.slug}`;
  const fixturesTest = `${GENERATED}
import { describe, expect, it } from "vitest";
import { check${n.pascal}Rules } from "${base}/rules";
import { create${n.pascal}Schema, to${n.pascal}Values, type Create${n.pascal}Input, type ${n.pascal}Row } from "${base}/schema";

const created = create${n.pascal}Schema.parse(${JSON.stringify(created)});
const imported = create${n.pascal}Schema.parse(${JSON.stringify(imported)});
const row = (input: Create${n.pascal}Input): ${n.pascal}Row => ({
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "org-e2e",
  createdAt: new Date("2026-10-12T09:00:00Z"),
  ...to${n.pascal}Values(input),
});

describe("${n.labelSingular} business rules accept the app's own samples", () => {
  it("accepts the end-to-end sample in an empty workspace", async () => {
    expect(await check${n.pascal}Rules(created, { existing: () => Promise.resolve([]) })).toBeNull();
  });

  it("accepts the imported sample next to the created one", async () => {
    expect(await check${n.pascal}Rules(imported, { existing: () => Promise.resolve([row(created)]) })).toBeNull();
  });
});
`;
  return {
    entity: e.name,
    pascal: n.pascal,
    slug: n.slug,
    rules: `src/entities/${n.slug}/rules.ts`,
    schema: `src/entities/${n.slug}/schema.ts`,
    table: `src/db/tables/${n.slug}.ts`,
    test: `tests/unit/rules/${n.slug}.test.ts`,
    fixtures: `tests/unit/rules/${n.slug}.fixtures.test.ts`,
    samples: { created, imported },
    formats,
    fixturesTest,
  };
}
