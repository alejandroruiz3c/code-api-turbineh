import { recordGap, type BackupCoder } from "@turbineh/backup-coder";
import { CODE_RULES, withoutTurbinehHeader, type Usage } from "./model.js";

/** One generated entity with the business rules the decider selected for it (trigger T3, ADR-0023). */
export interface RuleTarget {
  entity: string;
  pascal: string;
  slug: string;
  /** Acceptance criteria (rule texts) to implement, in the user's words. */
  rules: string[];
  files: {
    rules: string;
    schema: string;
    table: string;
    test: string;
    fixtures: string;
  };
  samples: { created: Record<string, string>; imported: Record<string, string> };
  formats: Record<string, string>;
  fixturesTest: string;
  /** Snapshot of the hook contracts (schema, table, src/lib/rules.ts), read before integration starts. */
  contracts: { schema: string; table: string; lib: string };
}

export interface WrittenRules {
  entity: string;
  rules: string[];
  /** Files to write into the app (kept in memory until the integration step has committed). */
  files: { path: string; content: string }[];
  module: string;
  test: string;
  fixtures: string;
  model: string;
  failedOver: boolean;
  usage: Usage;
  record: string;
}

/** Capability id used for swaps, metrics and catalog/gaps records of one entity's rules. */
export const rulesCapability = (slug: string) => `rules.${slug}`;

/**
 * Two small Backup Coder calls per entity (module, then its test against the module), minimal context: the rule
 * texts, the entity's schema and table files, the app's own E2E samples and the hook signature. Nothing is written
 * to the app here; the caller scans the files for secrets and commits them.
 */
export async function writeRules(
  target: RuleTarget,
  coder: BackupCoder,
  ctx: { buildId: string; summary: string; gapsDir: string },
): Promise<WrittenRules> {
  const schema = `// ${target.files.schema}\n${withoutTurbinehHeader(target.contracts.schema)}`;
  const P = target.pascal;
  const request = {
    buildId: ctx.buildId,
    trigger: "T3" as const,
    capability: rulesCapability(target.slug),
    context: {
      contracts: [
        schema,
        `// ${target.files.table}\n${withoutTurbinehHeader(target.contracts.table)}`,
        `// src/lib/rules.ts\n${target.contracts.lib}`,
      ],
      buildSpec: {
        summary: ctx.summary,
        entity: target.entity,
        rules: target.rules,
        samples_that_must_be_accepted: target.samples,
      },
    },
    instructions:
      `Write the module ${target.files.rules}. It must export exactly: ` +
      `\`export const check${P}Rules: ${P}Rules = async (input, ctx) => { ... }\` with ` +
      `\`import type { ${P}Rules } from "./schema";\` (add other type-only imports from "./schema" if needed). ` +
      "It runs on the server before a record is created or imported. Implement every rule in `rules`: return a short, " +
      "polite, user-facing message (no internal details) when `input` breaks a rule, otherwise return null. " +
      "Call `await ctx.existing()` only when a rule needs the other records of this entity (same workspace). " +
      "Treat missing optional values (undefined or null) as not matching. Compare text case-insensitively and trimmed. " +
      '"After", "before", "more than" and "less than" are strict (equal values break the rule); "from", "until", ' +
      '"at least" and "at most" include the boundary. ' +
      "The records in `samples_that_must_be_accepted` (created first, then imported next to it) must be accepted. " +
      "No other imports, no database, no network, no environment variables, no side effects. Do not read the current " +
      "date or time unless a rule explicitly depends on today. JSDoc above the export listing the rules. " +
      CODE_RULES,
    maxOutputTokens: 2500,
  };
  const mod = await coder.fill(request);
  const test = await coder.fill({
    ...request,
    context: {
      contracts: [mod.code, schema],
      buildSpec: {
        rules: target.rules,
        raw_value_formats: target.formats,
        valid_raw_input: target.samples.created,
      },
    },
    instructions:
      `Write a vitest unit test file for check${P}Rules, imported as "@/entities/${target.slug}/rules". ` +
      `Build inputs with create${P}Schema.parse({ ...valid_raw_input, ...overrides }) where every value is a raw ` +
      'form value in exactly the format given in `raw_value_formats` (strings; dates as YYYY-MM-DD; checkboxes "on" ' +
      "when true and omitted when false). Build existing records with " +
      `({ id: "row-1", organizationId: "org-1", createdAt: new Date("2026-10-12T09:00:00Z"), ...to${P}Values(input) }) ` +
      `typed as ${P}Row, all imported from "@/entities/${target.slug}/schema". Pass ` +
      "`{ existing: () => Promise.resolve(rows) }` as the context. For EACH rule: one test where a violating record is " +
      "rejected (the result is a non-empty string) and one where a valid record is accepted (null); for a comparison " +
      "rule, also one test with the two values exactly equal (strict words reject it, inclusive words accept it). Test titles in " +
      'double quotes, at most 120 characters, starting with the rule in plain words (for example it("No two active ' +
      'memberships per member: rejects a second active membership", ...)). Import { describe, expect, it } from "vitest". ' +
      "Deterministic: fixed dates only. " +
      CODE_RULES,
    maxOutputTokens: 2500,
  });
  const record = recordGap(ctx.gapsDir, request, mod);
  return {
    entity: target.entity,
    rules: target.rules,
    files: [
      { path: target.files.rules, content: mod.code },
      { path: target.files.test, content: test.code },
      { path: target.files.fixtures, content: target.fixturesTest },
    ],
    module: target.files.rules,
    test: target.files.test,
    fixtures: target.files.fixtures,
    model: mod.model,
    failedOver: mod.failedOver,
    usage: {
      input_tokens: mod.usage.input_tokens + test.usage.input_tokens,
      output_tokens: mod.usage.output_tokens + test.usage.output_tokens,
    },
    record,
  };
}
