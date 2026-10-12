import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import {
  assemble,
  entitiesToGenerate,
  entityNames,
  generateEntity,
  GENERATED,
  ruleFiles,
} from "./index.js";

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
    const recipes = mkdtempSync(join(tmpdir(), "recipes-"));
    const template = join(recipes, "base", "template");
    mkdirSync(join(template, "src/app"), { recursive: true });
    writeFileSync(
      join(recipes, "base", "recipe.yaml"),
      "id: base\ndescription: b\nextends: null\nprovidedEntities: []\ndefaultCapabilities: []\nnav: []\n",
    );
    mkdirSync(join(recipes, "child", "template"), { recursive: true });
    writeFileSync(
      join(recipes, "child", "recipe.yaml"),
      "id: child\ndescription: c\nextends: base\nprovidedEntities: [MembershipPlan]\ndefaultCapabilities: []\nnav: [{ label: Extra, href: /dashboard/extra }]\n",
    );
    writeFileSync(join(template, "package.json"), '{ "name": "__APP_SLUG__" }');
    writeFileSync(join(template, "src/app/layout.tsx"), "export const t = '__APP_NAME__';\n");
    const out = mkdtempSync(join(tmpdir(), "out-"));
    const res = assemble({
      buildId: "b1",
      recipesDir: recipes,
      recipe: "child",
      outDir: out,
      spec,
      selected: [],
      gaps: [{ capability: "payments.checkout", trigger: "T1" }],
    });
    expect(readFileSync(join(out, "package.json"), "utf8")).toContain("gym-manager");
    expect(readFileSync(join(out, "COMPONENTS.md"), "utf8")).toContain("payments.checkout");
    expect(res.generatedLines).toBeGreaterThan(0);
    // provided by the child recipe → not generated; extra nav from recipe.yaml
    expect(readFileSync(join(out, "src/entities/index.ts"), "utf8")).toContain("/dashboard/extra");
    expect(readFileSync(join(out, "src/entities/index.ts"), "utf8")).not.toContain(
      "membership-plans",
    );
    expect(res.reusedLines).toBeGreaterThan(0);
  });
});

describe("business rules hook (T3)", () => {
  const plan = spec.entities[1]!;

  it("every generated entity checks its rules on the server before create and import", () => {
    const files = generateEntity(plan, { csvExport: false, csvImport: true });
    const actions = files.find((f) => f.path.endsWith("/actions.ts"))?.content ?? "";
    expect(files.map((f) => f.path)).toContain("src/entities/membership-plans/rules.ts");
    expect(actions).toContain("await checkMembershipPlanRules(input, { existing: () =>");
    expect(actions).toContain("if (violation) throw new UserFacingError(violation);");
    expect(actions).toContain("if (await checkMembershipPlanRules(input, { existing })) continue;");
    expect(actions).toContain(".where(eq(membershipPlans.organizationId, organizationId))");
  });

  it("writes a fixture test from the app's own E2E samples, with later dates for later date fields", () => {
    const f = ruleFiles({
      name: "Loan",
      fields: [
        { name: "borrower", type: "string", required: true },
        { name: "email", type: "email", required: true },
        { name: "startDate", type: "date", required: true },
        { name: "endDate", type: "date", required: true },
      ],
    });
    expect(f.samples.created).toEqual({
      borrower: "Loan Borrower sample",
      email: "e2e@example.com",
      startDate: "2026-10-13",
      endDate: "2026-10-14",
    });
    expect(f.samples.imported.borrower).toBe("Loan Borrower sample imported");
    expect(f.samples.imported.email).toBe("e2e+imported@example.com");
    expect(f.fixturesTest.startsWith(GENERATED)).toBe(true);
    expect(f.fixtures).toBe("tests/unit/rules/loans.fixtures.test.ts");
  });
});
