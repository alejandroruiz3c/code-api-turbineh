import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { readAcceptanceJson } from "./agent-guide.js";
import { readRecipeActors } from "./aliases.js";
import { assemble } from "./assemble.js";

/** Actor aliases of recipes (ADR-0048): the staging build f0788924 of the Frontiers shop spec. */
const recipesDir = join(__dirname, "../../../catalog/recipes");

const ADMIN_PRODUCTS =
  "Given an administrator is signed in, when they access the admin area, then they must be able to create or edit product details.";
const ADMIN_ORDERS =
  "Given an administrator is signed in, when they view the admin dashboard, then they must see a list of all completed orders.";

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

function statuses(recipe: BuildSpec["recipe"], criteria: string[]) {
  const outDir = join(mkdtempSync(join(tmpdir(), "actor-aliases-")), "app");
  assemble({
    buildId: "b-actors",
    recipesDir,
    recipe,
    outDir,
    spec: spec(recipe, criteria),
    selected: [],
    gaps: [],
  });
  return readAcceptanceJson(outDir);
}

describe("recipe actor aliases", () => {
  it("proves the staging shop's administrator criteria with the owner tests that assert them", () => {
    const [products, orders] = statuses("storefront", [ADMIN_PRODUCTS, ADMIN_ORDERS]);
    expect(products?.status).toBe("covered");
    expect(products?.tests.join(" ")).toMatch(
      /creates a product, reads it in the list, edits its details/,
    );
    expect(orders?.status).toBe("covered");
    expect(orders?.tests.join(" ")).toMatch(/sees the list of all orders/);
  });

  it("keeps the refusal and the other actors strict", () => {
    const [refusal, member, customer] = statuses("storefront", [
      "Given an administrator is signed in, when they view the admin dashboard, then they cannot see another shop's orders.",
      "Given a member is signed in, when they access the admin area, then they can create or edit product details.",
      "Given a customer is signed in, when they view the admin dashboard, then they see a list of all completed orders.",
    ]);
    expect([refusal?.status, member?.status, customer?.status]).toEqual(["open", "open", "open"]);
  });

  it("only where the recipe's role model says so: saas-crud's owner is not its admin", () => {
    expect(readRecipeActors(join(recipesDir, "saas-crud"))).toEqual([]);
    const [products] = statuses("saas-crud", [ADMIN_PRODUCTS]);
    expect(products?.status).toBe("open");
  });

  it("every declared actor alias says why it holds", () => {
    const declared = readdirSync(recipesDir).filter((r) =>
      existsSync(join(recipesDir, r, "aliases.yaml")),
    );
    expect(declared).toEqual(
      expect.arrayContaining(["client-portal", "corporate-site", "landing-waitlist", "storefront"]),
    );
    for (const r of declared)
      for (const a of readRecipeActors(join(recipesDir, r)))
        expect(a.why.length, r).toBeGreaterThan(40);
  });
});
