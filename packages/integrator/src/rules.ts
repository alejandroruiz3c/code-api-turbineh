import { recordGap, type BackupCoder } from "@turbineh/backup-coder";
import { CODE_RULES, withoutTurbinehHeader, type Usage } from "./model.js";

/** One rule to implement: its text, when it runs and which related entities it reads (ADR-0023, ADR-0026). */
export interface RuleSpec {
  rule: string;
  operations: ("create" | "update")[];
  related: string[];
}

/** A generated entity whose records the rules may read through a code-written, read-only loader. */
export interface RelatedTarget {
  entity: string;
  pascal: string;
  slug: string;
  /** Key of its loader in `ctx.related`. */
  key: string;
  /** Reference fields of the restricted entity that hold this entity's display value. */
  referencedBy: string[];
  displayField: string;
  /** Raw form values of a valid record of this entity. */
  sample: Record<string, string>;
  /** Its schema file (types and create schema), read before integration starts. */
  schema: string;
}

/** One generated entity with the business rules the decider selected for it (trigger T3, ADR-0023/ADR-0026). */
export interface RuleTarget {
  entity: string;
  pascal: string;
  slug: string;
  /** Acceptance criteria (rule texts) to implement, in the user's words. */
  rules: string[];
  specs: RuleSpec[];
  files: {
    rules: string;
    schema: string;
    table: string;
    related: string;
    test: string;
    fixtures: string;
  };
  samples: {
    created: Record<string, string>;
    imported: Record<string, string>;
    edited: Record<string, string> | null;
  };
  formats: Record<string, string>;
  fixturesTest: string;
  /** Read-only loaders of the related entities (code-written); null when the rules read no other entity. */
  relatedModule: string | null;
  related: RelatedTarget[];
  /** Snapshot of the hook contracts (schema, table, src/lib/rules.ts), read before integration starts. */
  contracts: { schema: string; table: string; lib: string };
}

export interface WrittenRules {
  entity: string;
  rules: string[];
  specs: RuleSpec[];
  /** Files to write into the app (kept in memory until the integration step has committed). */
  files: { path: string; content: string }[];
  module: string;
  test: string;
  fixtures: string;
  /** `related.ts` rewritten with loaders (restored to the assembled stub when the rules are dropped). */
  relatedModule: string | null;
  model: string;
  failedOver: boolean;
  usage: Usage;
  record: string;
}

/** Capability id used for swaps, metrics and catalog/gaps records of one entity's rules. */
export const rulesCapability = (slug: string) => `rules.${slug}`;

/**
 * Two small Backup Coder calls per entity (module, then its test against the module), minimal context: the rule
 * texts with when they run, the entity's schema and table files, the schemas of the related entities it reads (only
 * those), the app's own E2E samples and the hook signature. Nothing is written to the app here; the caller scans the
 * files for secrets and commits them.
 */
export async function writeRules(
  target: RuleTarget,
  coder: BackupCoder,
  ctx: { buildId: string; summary: string; gapsDir: string },
): Promise<WrittenRules> {
  const schema = `// ${target.files.schema}\n${withoutTurbinehHeader(target.contracts.schema)}`;
  const relatedSchemas = target.related.map(
    (r) => `// src/entities/${r.slug}/schema.ts\n${withoutTurbinehHeader(r.schema)}`,
  );
  const P = target.pascal;
  const reads = target.related.length > 0;
  const rules = target.specs.map((s) => ({
    rule: s.rule,
    applies_on: s.operations,
    ...(s.related.length ? { reads: s.related } : {}),
  }));
  const relatedInfo = target.related.map((r) => ({
    entity: r.entity,
    loader: `ctx.related.${r.key}()`,
    row_type: `${r.pascal}Row from "@/entities/${r.slug}/schema"`,
    reference_fields_of_input: r.referencedBy,
    matched_by: `${r.displayField} (the reference fields hold this value)`,
  }));
  const request = {
    buildId: ctx.buildId,
    trigger: "T3" as const,
    capability: rulesCapability(target.slug),
    context: {
      contracts: [
        schema,
        `// ${target.files.table}\n${withoutTurbinehHeader(target.contracts.table)}`,
        `// src/lib/rules.ts\n${target.contracts.lib}`,
        ...(target.relatedModule ? [`// ${target.files.related}\n${target.relatedModule}`] : []),
        ...relatedSchemas,
      ],
      buildSpec: {
        summary: ctx.summary,
        entity: target.entity,
        rules,
        ...(reads ? { related_entities: relatedInfo } : {}),
        samples_that_must_be_accepted: target.samples,
      },
    },
    instructions:
      `Write the module ${target.files.rules}. It must export exactly: ` +
      `\`export const check${P}Rules: ${P}Rules = async (input, ctx) => { ... }\` with ` +
      `\`import type { ${P}Rules } from "./schema";\` (add other type-only imports from "./schema"` +
      (reads ? ' or from the related entities\' "@/entities/<slug>/schema"' : "") +
      ' if needed). It runs on the server before a record is created or imported (`ctx.operation` is "create", ' +
      '`ctx.previous` is null) and before an existing record is changed (`ctx.operation` is "update", ' +
      "`ctx.previous` is the record before the change, and `ctx.existing()` already excludes it). Implement every rule " +
      "in `rules`, each only for the operations in its `applies_on`: return a short, polite, user-facing message (no " +
      "internal details) when `input` breaks a rule, otherwise return null. " +
      "Call `await ctx.existing()` only when a rule needs the other records of this entity (same workspace). " +
      (reads
        ? "A rule with `reads` gets the records of those entities with the loader given in `related_entities` " +
          "(read-only, same workspace); a reference field of `input` holds the `matched_by` value of the referenced " +
          "record: find it by comparing case-insensitively and trimmed, and treat a missing record as breaking an " +
          '"exists" rule. Call each loader only when needed. '
        : "") +
      "Treat missing optional values (undefined or null) as not matching. Compare text case-insensitively and trimmed. " +
      '"After", "before", "more than" and "less than" are strict (equal values break the rule); "from", "until", ' +
      '"at least" and "at most" include the boundary. ' +
      "The records in `samples_that_must_be_accepted` must be accepted: `created` first, then `imported` next to it, " +
      "and `edited` as an update of `created`. " +
      "No other imports, no database, no network, no environment variables, no side effects. Do not read the current " +
      "date or time unless a rule explicitly depends on today. JSDoc above the export listing the rules. " +
      CODE_RULES,
    maxOutputTokens: 3000,
  };
  const mod = await coder.fill(request);
  const relatedExpr = reads
    ? `{ ${target.related.map((r) => `${r.key}: () => Promise.resolve(${r.key}Rows)`).join(", ")} }`
    : "{}";
  const test = await coder.fill({
    ...request,
    context: {
      contracts: [mod.code, schema, ...relatedSchemas],
      buildSpec: {
        rules,
        raw_value_formats: target.formats,
        valid_raw_input: target.samples.created,
        ...(reads
          ? {
              related_valid_raw_input: Object.fromEntries(
                target.related.map((r) => [r.entity, r.sample]),
              ),
            }
          : {}),
      },
    },
    instructions:
      `Write a vitest unit test file for check${P}Rules, imported as "@/entities/${target.slug}/rules". ` +
      `Build inputs with create${P}Schema.parse({ ...valid_raw_input, ...overrides }) where every value is a raw ` +
      'form value in exactly the format given in `raw_value_formats` (strings; dates as YYYY-MM-DD; checkboxes "on" ' +
      "when true and omitted when false). Build records with " +
      `({ id: "row-1", organizationId: "org-1", createdAt: new Date("2026-10-12T09:00:00Z"), ...to${P}Values(input) }) ` +
      `typed as ${P}Row, all imported from "@/entities/${target.slug}/schema". ` +
      (reads
        ? `Build related records the same way with each related entity's create schema, to…Values and …Row type ` +
          "imported from its own schema file, starting from `related_valid_raw_input`, into arrays named " +
          `${target.related.map((r) => `${r.key}Rows`).join(", ")}. `
        : "") +
      "Pass as the context `{ operation, previous, existing: () => Promise.resolve(rows), related: " +
      `${relatedExpr} }` +
      '` with operation "create" and previous null, or operation "update" and previous set to the record before the ' +
      "change. For EACH rule and each operation in its `applies_on`: one test where a violating record is rejected " +
      "(the result is a non-empty string) and one where a valid record is accepted (null); for a comparison rule, " +
      "also one test with the two values exactly equal (strict words reject it, inclusive words accept it); for a rule " +
      'that applies only on "create" or only on "update", one test showing the other operation is not restricted. ' +
      'Test titles in double quotes, at most 120 characters, starting with the rule in plain words (for example it("No ' +
      'two active memberships per member: rejects a second active membership", ...)). Import { describe, expect, it } ' +
      'from "vitest". Deterministic: fixed dates only. ' +
      CODE_RULES,
    maxOutputTokens: 3000,
  });
  const record = recordGap(ctx.gapsDir, request, mod);
  return {
    entity: target.entity,
    rules: target.rules,
    specs: target.specs,
    files: [
      { path: target.files.rules, content: mod.code },
      { path: target.files.test, content: test.code },
      { path: target.files.fixtures, content: target.fixturesTest },
      ...(target.relatedModule
        ? [{ path: target.files.related, content: target.relatedModule }]
        : []),
    ],
    module: target.files.rules,
    test: target.files.test,
    fixtures: target.files.fixtures,
    relatedModule: target.relatedModule ? target.files.related : null,
    model: mod.model,
    failedOver: mod.failedOver,
    usage: {
      input_tokens: mod.usage.input_tokens + test.usage.input_tokens,
      output_tokens: mod.usage.output_tokens + test.usage.output_tokens,
    },
    record,
  };
}
