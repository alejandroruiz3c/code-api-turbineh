import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { acceptanceStatus } from "./acceptance.js";
import { verifiedGuide } from "./agent-guide.js";
import { assemble, coverageRules, entityCoverage } from "./assemble.js";

/** Zero-friction packages (ADR-0034): acceptance criteria proven by shipped tests, local database, own URLs. */
const recipesDir = join(__dirname, "../../../catalog/recipes");

// The criteria the compiler extracted from the Frontiers shop spec (bench/frontiers, Capability A, 2026-10-13 run).
const SHOP_CRITERIA = [
  "Given a user is browsing the catalogue, when they enter a product name in the search bar, then the displayed list must filter to only show matching products.",
  "Given a user is on a product page, when they click the 'Add to Cart' button, then the item must appear in the cart with the correct price and initial quantity of one.",
  "Given a user has items in their cart, when they increase the quantity of a specific item, then the cart subtotal must update to reflect the new total.",
  "Given a user proceeds to checkout, when they complete the Stripe payment, then the server must receive a signed webhook and mark the order status as 'Paid'.",
  "Given an order is marked as 'Paid' via webhook, then the stock level for each purchased product must be decremented by the quantity ordered.",
  "Given a successful payment, when the order process completes, then an order confirmation email must be logged to the console containing the order details.",
  "Given an authenticated admin user is in the admin area, when they update a product's stock level, then the change must be reflected in the public catalogue.",
];

const spec = (recipe: BuildSpec["recipe"], criteria: string[]): BuildSpec => ({
  recipe,
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Northwind Coffee Roasters",
  slug: "northwind",
  summary: "Online shop for a small coffee roaster.",
  roles: ["owner"],
  entities: [],
  pages: [{ path: "/", purpose: "Home", auth_required: false }],
  capabilities: ["security.headers", "data.validation"],
  acceptance_criteria: criteria,
});

function build(recipe: BuildSpec["recipe"], criteria: string[]): string {
  const outDir = join(mkdtempSync(join(tmpdir(), "zero-friction-")), "app");
  assemble({
    buildId: "b-zf",
    recipesDir,
    recipe,
    outDir,
    spec: spec(recipe, criteria),
    selected: [],
    gaps: [],
  });
  return outDir;
}

describe("zero-friction packages (ADR-0034)", () => {
  it("proves every criterion of the bench shop spec with a test the storefront ships", () => {
    const statuses = acceptanceStatus(
      SHOP_CRITERIA,
      coverageRules({ recipesDir, recipe: "storefront", selected: [] }),
    );
    expect(statuses.filter((s) => s.status === "open").map((s) => s.criterion)).toEqual([]);
    expect(statuses[6]?.tests).toContain(
      "tests/e2e/shop.spec.ts › the admin updates a product's stock and the public catalogue reflects it at once",
    );
  });

  it("after verification: deterministic proofs win, non-test evidence is never 'met', and ACCEPTANCE.md agrees with AGENTS.md", () => {
    const extra = "Shoppers can leave product reviews with star ratings";
    const dir = build("storefront", [...SHOP_CRITERIA, extra]);
    const guide = verifiedGuide(dir, {
      gate: {
        ok: true,
        verifiedAt: "2026-10-13T00:00:00.000Z",
        environment: "sandbox",
        steps: [],
        findings: [],
      },
      criteria: [
        ...SHOP_CRITERIA.map((criterion) => ({
          criterion,
          evidence: "Not verified automatically",
          verified: false,
        })),
        { criterion: extra, evidence: "Strict type checking and production build", verified: true },
      ],
    });
    expect(guide?.criteria.slice(0, 7).every((c) => c.status === "met" && c.test)).toBe(true);
    const open = guide?.criteria[7];
    expect(open?.status).toBe("open");
    expect(open?.testFile).toBe("tests/e2e/shop.spec.ts");
    expect(guide?.left[0]?.where).toContain("tests/e2e/shop.spec.ts");
    const acceptance = readFileSync(join(dir, "ACCEPTANCE.md"), "utf8");
    expect(acceptance).toContain("1 of 8 criteria are open");
    expect(acceptance).toContain(
      "the admin updates a product's stock and the public catalogue reflects it at once",
    );
  });

  it("proves generated entity criteria with the generated entity tests", () => {
    const dir = build("saas-crud", []);
    expect(entityCoverage(dir, [])).toEqual([]);
    const withEntity: BuildSpec = {
      ...spec("saas-crud", [
        "The owner adds a supplier with a contact email",
        "Owners edit a supplier",
      ]),
      entities: [
        {
          name: "Supplier",
          fields: [
            { name: "name", type: "string", required: true },
            { name: "contactEmail", type: "email", required: false },
          ],
        },
      ] as BuildSpec["entities"],
    };
    const outDir = join(mkdtempSync(join(tmpdir(), "zero-friction-")), "app");
    assemble({
      buildId: "b-e",
      recipesDir,
      recipe: "saas-crud",
      outDir,
      spec: withEntity,
      selected: [],
      gaps: [],
    });
    const rules = entityCoverage(outDir, ["Supplier"]);
    const statuses = acceptanceStatus(withEntity.acceptance_criteria, rules);
    expect(statuses.map((s) => s.status)).toEqual(["covered", "covered"]);
    expect(statuses[0]?.tests[0]).toMatch(
      /^tests\/e2e\/suppliers?\.spec\.ts › owner creates a supplier/,
    );
  });

  it("ships the zero-setup database and lets E2E own its URLs", () => {
    const dir = build("storefront", []);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["db:local"]).toContain("scripts/local-db.ts --serve");
    expect(pkg.scripts["test:e2e"]).toContain("scripts/local-db.ts --run --fresh --migrate");
    expect(pkg.scripts["db:migrate"]).toContain("scripts/local-db.ts --run");
    const pw = readFileSync(join(dir, "playwright.config.ts"), "utf8");
    expect(pw).toContain("process.env.BETTER_AUTH_URL = origin");
    expect(pw).not.toMatch(/process\.env\.PORT \?\?/);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("pnpm db:local");
    expect(agents).toContain("zero-setup local PostgreSQL");
  });
});
