import type { BuildSpec } from "@turbineh/compiler";
import type { GeneratedFile } from "./entities.js";
import type { Field } from "./fields.js";
import { camel, entityNames } from "./naming.js";

type Entity = BuildSpec["entities"][number];

/** Strong verbs: the entity name anywhere in the sentence is enough. */
const LOOKUP = /\b(look(?:s|ing)?\s*up|lookup|consult(?:s|ing)?|track(?:s|ing)?|status of)\b/i;
/** Weak verbs ("find", "check") count only when followed by the entity and an identifier ("order number"). */
const WEAK = /\b(find(?:s|ing)?|check(?:s|ing)?)\b/i;
const IDENT = "(?:number|no\\.?|#|code|reference|ref|id|tracking)";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Entities a criterion (or the summary) says the assistant looks up: "looks up order status by order number". */
export function lookupEntities(
  spec: Pick<BuildSpec, "acceptance_criteria" | "summary">,
  entities: Entity[],
): Entity[] {
  const texts = [spec.summary, ...spec.acceptance_criteria].map((t) => t.toLowerCase());
  return entities.filter((e) => {
    const n = entityNames(e.name);
    const words = [n.labelSingular, n.labelPlural].map((w) => w.toLowerCase());
    return texts.some((t) =>
      words.some(
        (w) =>
          (LOOKUP.test(t) && t.includes(w)) ||
          (WEAK.test(t) &&
            new RegExp(`\\b(?:find|check)\\w*\\b.*\\b${esc(w)}\\s+${IDENT}`, "i").test(t)),
      ),
    );
  });
}

const keyField = (e: Entity): Field | undefined =>
  e.fields.find(
    (f) => /(number|code|reference|ref|tracking)$/i.test(f.name) && f.type !== "boolean",
  ) ?? e.fields.find((f) => f.type === "string");
const statusField = (e: Entity): Field | undefined =>
  e.fields.find((f) => /(status|state|stage)$/i.test(f.name));

/** src/server/agent-tools.ts with one read-only, tenant-scoped `lookup_<entity>` tool per looked-up entity, plus its test. */
export function agentToolFiles(
  spec: Pick<BuildSpec, "acceptance_criteria" | "summary">,
  entities: Entity[],
): GeneratedFile[] {
  const tools = lookupEntities(spec, entities)
    .map((e) => ({ e, n: entityNames(e.name), key: keyField(e), status: statusField(e) }))
    .filter((t): t is typeof t & { key: Field } => Boolean(t.key));
  if (!tools.length) return [];
  const imports = tools.map((t) => t.n.variable).join(", ");
  const body = tools
    .map(({ n, key, status }) => {
      const k = camel(key.name);
      const tool = `lookup_${camel(n.pascal).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
      const label = n.labelSingular.toLowerCase();
      const statusExpr = status ? `row.${camel(status.name)}` : `"on record"`;
      return `  {
    spec: {
      name: "${tool}",
      description: "Look up a ${label} of this workspace by ${key.name} and tell the user its status (read-only).",
      irreversible: false,
    },
    label: "Look up a ${label}",
    params: z.object({ ${k}: z.string().trim().min(1).max(120) }),
    argsFrom: (text: string) => {
      const m = /#?\\b([A-Za-z]{0,6}-?\\d[\\w-]{0,40})\\b/.exec(text);
      return m ? { ${k}: m[1] } : null;
    },
    run: async (ctx, args) => {
      // Lazy: importing the registry (tests, pages) must not open the database or read env.
      const { db } = await import("@/db/client");
      const [row] = await db
        .select()
        .from(${n.variable})
        .where(and(eq(${n.variable}.organizationId, ctx.organizationId), eq(${n.variable}.${k}, args.${k})))
        .limit(1);
      if (!row) return \`No ${label} found with ${key.name} \${args.${k}}.\`;
      return \`${n.labelSingular} \${args.${k}}: \${String(${statusExpr})}.\`;
    },
  } satisfies ReadTool<z.ZodObject<{ ${k}: z.ZodString }>>`;
    })
    .join(",\n");
  const content = `import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ${imports} } from "@/db/schema";
import type { ReadTool } from "@/server/tools";

/**
 * Read-only agent tools generated from the request (assembler): the assistant looks these records up, scoped to the
 * workspace. Not found → an explicit message the assistant relays. Registered in src/server/tools.ts.
 */
export const GENERATED_READ_TOOLS: readonly ReadTool[] = [
${body},
] as unknown as readonly ReadTool[];
`;
  // One test per tool, titled with its entity: the canonical criterion `ai-agents.lookup` (ADR-0069) links each looked-up
  // entity to its own test.
  const cases = tools
    .map(({ n, key, status }) => {
      const tool = `lookup_${camel(n.pascal).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
      const label = n.labelSingular.toLowerCase();
      const k = camel(key.name);
      return `  it("the assistant looks up a ${label} by its reference and tells the user its status, or that it was not found", async () => {
    const { allowedTools } = await import("@/lib/ai/guard");
    const { TOOL_REGISTRY, runReadTool } = await import("@/server/tools");
    expect(allowedTools(TOOL_REGISTRY, ["${tool}"]).map((t) => t.name)).toEqual(["${tool}"]);
    const ctx = { organizationId: "org-1", userId: "u-1" };
    rows.length = 0;
    expect(await runReadTool("${tool}", ctx, "Where is A-1001?"), "not found is relayed").toMatch(/not found|No /i);
    rows.push({ ${k}: "A-1001"${status ? `, ${camel(status.name)}: "shipped"` : ""} });
    const reply = await runReadTool("${tool}", ctx, "Where is A-1001?");
    expect(reply, "the reference is looked up").toContain("A-1001");
    expect(reply, "its status is told").toContain(${status ? `"shipped"` : `"on record"`});
    expect(await runReadTool("${tool}", ctx, "where is it?")).toMatch(/more details/);
  });`;
    })
    .join("\n\n");
  const test = `import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) },
}));

describe("agent tools (generated)", () => {
${cases}
});
`;
  return [
    { path: "src/server/agent-tools.ts", content },
    { path: "tests/unit/agent-tools.test.ts", content: test },
  ];
}
