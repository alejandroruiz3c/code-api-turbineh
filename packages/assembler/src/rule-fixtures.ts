import type { BuildSpec } from "@turbineh/compiler";
import {
  displayField,
  fieldsOf,
  GENERATED,
  importedSample,
  referenceTarget,
  sampleFor,
  seedSample,
} from "./entities.js";
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

/** A generated entity whose records another entity's rules may read (ADR-0026). */
export interface RelatedEntity {
  entity: string;
  pascal: string;
  slug: string;
  /** Key of its loader in `ctx.related` (e.g. `teachers`). */
  key: string;
  schema: string;
  table: string;
  /** Fields of the restricted entity that hold this entity's display value (reference fields). */
  referencedBy: string[];
  /** Field of this entity that a reference holds (what people type to identify a record). */
  displayField: string;
  /** Raw form values of a valid record of this entity (the one the app's own E2E test creates first). */
  sample: Record<string, string>;
}

/** Where the business rules of one generated entity live (Backup Coder trigger T3, ADR-0023/ADR-0026). */
export interface RuleFiles {
  entity: string;
  pascal: string;
  slug: string;
  rules: string;
  schema: string;
  table: string;
  related: string;
  test: string;
  fixtures: string;
  /** Raw form values the app's own end-to-end tests submit (create form, CSV import row, edit form). */
  samples: {
    created: Record<string, string>;
    imported: Record<string, string>;
    edited: Record<string, string> | null;
  };
  /** Exact raw value format the create schema accepts for each field (given to the Backup Coder). */
  formats: Record<string, string>;
  /** Related entities the rules read, with their loaders (empty when the rules only need this entity). */
  relatedEntities: RelatedEntity[];
  /** `src/entities/<slug>/related.ts` with read-only loaders for `relatedEntities` (written by code, never a model). */
  relatedModule: string | null;
  /** Deterministic test: the rules must accept the app's own end-to-end samples (written by code, never a model). */
  fixturesTest: string;
}

/** Generated entities this entity points to through reference fields (deterministic). */
export function referencedEntities(e: Entity, all: Entity[]): string[] {
  const out = new Set<string>();
  for (const f of fieldsOf(e)) {
    const t = referenceTarget(f, e, all);
    if (t) out.add(t.name);
  }
  return [...out];
}

export function ruleFiles(e: Entity, all: Entity[] = [e], relatedNames: string[] = []): RuleFiles {
  const n = entityNames(e.name);
  const fields = fieldsOf(e);
  const firstText = fields.find((f) => ["string", "text", "enum", "reference"].includes(f.type));
  const editable = fields.find((f) => ["string", "text", "enum"].includes(f.type));
  const created: Record<string, string> = {};
  const imported: Record<string, string> = {};
  const formats: Record<string, string> = {};
  for (const f of fields) {
    const target = referenceTarget(f, e, all);
    const display = target ? displayField(target) : undefined;
    formats[camel(f.name)] =
      `${target && display ? `text: the ${display.name} of a ${target.name} record` : FORMATS[f.type]}${f.required ? "" : "; optional (omit it)"}`;
    const v = sampleFor(e, f, all);
    if (f.required || f === firstText) created[camel(f.name)] = v;
    imported[camel(f.name)] =
      f.type === "boolean"
        ? "true"
        : target && display
          ? sampleFor(e, f, all, "imported")
          : importedSample(f, v, "imported");
  }
  const edited = editable
    ? { ...created, [camel(editable.name)]: `${sampleFor(e, editable, all)} edited` }
    : null;

  const relatedEntities: RelatedEntity[] = relatedNames.flatMap((name) => {
    const r = all.find((x) => x.name === name);
    const display = r ? displayField(r) : undefined;
    if (!r || !display || r.name === e.name) return [];
    const rn = entityNames(r.name);
    return [
      {
        entity: r.name,
        pascal: rn.pascal,
        slug: rn.slug,
        key: rn.variable,
        schema: `src/entities/${rn.slug}/schema.ts`,
        table: `src/db/tables/${rn.slug}.ts`,
        referencedBy: fields
          .filter((f) => referenceTarget(f, e, all)?.name === r.name)
          .map((f) => camel(f.name)),
        displayField: camel(display.name),
        sample: seedSample(r, e, all),
      },
    ];
  });

  const relatedModule = relatedEntities.length
    ? `${GENERATED}
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ${relatedEntities.map((r) => r.key).join(", ")} } from "@/db/schema";
import { bindRelated, RULES_SCAN_LIMIT } from "@/lib/rules";
${relatedEntities.map((r) => `import type { ${r.pascal}Row } from "@/entities/${r.slug}/schema";`).join("\n")}

/**
 * Related records the business rules of ${n.labelPlural.toLowerCase()} read (ADR-0026): read-only, same workspace only, newest
 * first, bounded. Written by TurbineH from the app's schema, never by a model.
 */
export const related${n.pascal}Loaders = {
${relatedEntities
  .map(
    (r) => `  ${r.key}: (organizationId: string): Promise<readonly ${r.pascal}Row[]> =>
    db
      .select()
      .from(${r.key})
      .where(eq(${r.key}.organizationId, organizationId))
      .orderBy(desc(${r.key}.createdAt))
      .limit(RULES_SCAN_LIMIT),`,
  )
  .join("\n")}
};

export const related${n.pascal} = (organizationId: string) => bindRelated(related${n.pascal}Loaders, organizationId);
export type ${n.pascal}Related = ReturnType<typeof related${n.pascal}>;
`
    : null;

  const base = `@/entities/${n.slug}`;
  const rowOf = (pascal: string, id: string) =>
    `(input: Create${pascal}Input): ${pascal}Row => ({
  id: "${id}",
  organizationId: "org-e2e",
  createdAt: new Date("2026-10-12T09:00:00Z"),
  ...to${pascal}Values(input),
})`;
  const relatedImports = relatedEntities
    .map(
      (r) =>
        `import { create${r.pascal}Schema, to${r.pascal}Values, type Create${r.pascal}Input, type ${r.pascal}Row } from "@/entities/${r.slug}/schema";`,
    )
    .join("\n");
  const relatedValue = relatedEntities.length
    ? `{
${relatedEntities
  .map((r, i) => {
    const target = all.find((x) => x.name === r.entity) ?? e;
    const make = (k: number) =>
      `(${rowOf(r.pascal, `00000000-0000-4000-8000-0000000001${i}${k}`)})`;
    return `  ${r.key}: () =>
    Promise.resolve([
      ${make(0)}(create${r.pascal}Schema.parse(${JSON.stringify(seedSample(target, e, all))})),
      ${make(1)}(create${r.pascal}Schema.parse(${JSON.stringify(seedSample(target, e, all, "imported"))})),
    ]),`;
  })
  .join("\n")}
}`
    : "{}";

  const fixturesTest = `${GENERATED}
import { describe, expect, it } from "vitest";
import { check${n.pascal}Rules } from "${base}/rules";
import { create${n.pascal}Schema, to${n.pascal}Values, type Create${n.pascal}Input, type ${n.pascal}Row } from "${base}/schema";
${relatedImports}

const created = create${n.pascal}Schema.parse(${JSON.stringify(created)});
const imported = create${n.pascal}Schema.parse(${JSON.stringify(imported)});
const row = ${rowOf(n.pascal, "00000000-0000-4000-8000-000000000001")};
// The records the app's own end-to-end test creates first for the reference fields.
const related = ${relatedValue};
const ctx = (operation: "create" | "update", previous: ${n.pascal}Row | null, rows: ${n.pascal}Row[]) => ({
  operation,
  previous,
  existing: () => Promise.resolve(rows),
  related,
});

describe("${n.labelSingular} business rules accept the app's own samples", () => {
  it("accepts the end-to-end sample in an empty workspace", async () => {
    expect(await check${n.pascal}Rules(created, ctx("create", null, []))).toBeNull();
  });

  it("accepts the imported sample next to the created one", async () => {
    expect(await check${n.pascal}Rules(imported, ctx("create", null, [row(created)]))).toBeNull();
  });
${
  edited
    ? `
  it("accepts the end-to-end edit of the created sample", async () => {
    const edited = create${n.pascal}Schema.parse(${JSON.stringify(edited)});
    expect(await check${n.pascal}Rules(edited, ctx("update", row(created), [row(imported)]))).toBeNull();
  });
`
    : ""
}});
`;
  return {
    entity: e.name,
    pascal: n.pascal,
    slug: n.slug,
    rules: `src/entities/${n.slug}/rules.ts`,
    schema: `src/entities/${n.slug}/schema.ts`,
    table: `src/db/tables/${n.slug}.ts`,
    related: `src/entities/${n.slug}/related.ts`,
    test: `tests/unit/rules/${n.slug}.test.ts`,
    fixtures: `tests/unit/rules/${n.slug}.fixtures.test.ts`,
    samples: { created, imported, edited },
    formats,
    relatedEntities,
    relatedModule,
    fixturesTest,
  };
}
