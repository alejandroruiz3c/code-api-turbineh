import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { assemble, entitiesToGenerate, entityNames, generateEntity, GENERATED } from "./index.js";

const spec: BuildSpec = {
  recipe: "saas-crud",
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Gym Manager",
  slug: "gym-manager",
  summary: "Manage members and plans.",
  roles: ["admin", "staff"],
  entities: [
    { name: "Organization", fields: [{ name: "name", type: "string", required: true }] },
    {
      name: "MembershipPlan",
      fields: [
        { name: "id", type: "string", required: true },
        { name: "planName", type: "string", required: true },
        { name: "monthlyPrice", type: "decimal", required: true },
        { name: "active", type: "boolean", required: false },
        { name: "startDate", type: "date", required: false },
      ],
    },
  ],
  pages: [{ path: "/plans", purpose: "Plans", auth_required: true }],
  capabilities: ["auth.session", "security.headers", "data.validation"],
  acceptance_criteria: [
    "Owner can create a plan",
    "Plans are scoped to the workspace",
    "Anonymous users are redirected",
  ],
};

describe("naming", () => {
  it("derives table, slug and labels", () => {
    expect(entityNames("MembershipPlan")).toMatchObject({
      table: "membership_plans",
      slug: "membership-plans",
      variable: "membershipPlans",
      labelPlural: "Membership plans",
    });
    expect(entityNames("Category").table).toBe("categories");
  });
});

describe("entity generation", () => {
  it("skips entities the auth component provides and reserved fields", () => {
    const ents = entitiesToGenerate(spec);
    expect(ents.map((e) => e.name)).toEqual(["MembershipPlan"]);
    const table = generateEntity(ents[0]!).find((f) =>
      f.path.endsWith("tables/membership-plans.ts"),
    )!.content;
    expect(table.startsWith(GENERATED)).toBe(true);
    expect(table).toContain('organizationId: varchar("organization_id"');
    expect(table.match(/\bid:/g)).toHaveLength(1);
  });

  it("scopes every query and action by organization and checks roles", () => {
    const files = generateEntity(entitiesToGenerate(spec)[0]!);
    const actions = files.find((f) => f.path.endsWith("actions.ts"))!.content;
    expect(actions).toContain("requireMember()");
    expect(actions).toContain('can(ctx.role, "create")');
    expect(actions).toContain("eq(membershipPlans.organizationId, ctx.organizationId)");
    const page = files.find((f) => f.path.endsWith("page.tsx"))!.content;
    expect(page).toContain("eq(membershipPlans.organizationId, ctx.organizationId)");
  });
});

describe("assemble", () => {
  it("fills placeholders, writes generated code and docs, and counts reused vs generated lines", () => {
    const template = mkdtempSync(join(tmpdir(), "tpl-"));
    mkdirSync(join(template, "src/app"), { recursive: true });
    writeFileSync(join(template, "package.json"), '{ "name": "__APP_SLUG__" }');
    writeFileSync(join(template, "src/app/layout.tsx"), "export const t = '__APP_NAME__';\n");
    const out = mkdtempSync(join(tmpdir(), "out-"));
    const res = assemble({
      buildId: "b1",
      templateDir: template,
      outDir: out,
      spec,
      selected: [],
      gaps: [{ capability: "payments.checkout", trigger: "T1" }],
    });
    expect(readFileSync(join(out, "package.json"), "utf8")).toContain("gym-manager");
    expect(readFileSync(join(out, "COMPONENTS.md"), "utf8")).toContain("payments.checkout");
    expect(res.generatedLines).toBeGreaterThan(0);
    expect(res.reusedLines).toBeGreaterThan(0);
  });
});
