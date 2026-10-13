import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { assemble } from "./assemble.js";
import { aboutOf, type PackageGuide, verifiedGuide, whereFor } from "./agent-guide.js";

const recipesDir = join(__dirname, "../../../catalog/recipes");

const spec: BuildSpec = {
  recipe: "storefront",
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Northwind Coffee Roasters",
  slug: "northwind",
  summary: "Online shop for a small coffee roaster.",
  roles: ["owner"],
  entities: [],
  pages: [{ path: "/shop", purpose: "Catalogue", auth_required: false }],
  capabilities: ["security.headers", "data.validation"],
  acceptance_criteria: [
    "Shoppers search the catalogue by name or description",
    "A signed Stripe webhook marks the order as paid and decrements stock",
    "Shoppers can leave product reviews with star ratings",
  ],
  palette: { background: "#001a5a", accent: "#34d8c4", cta: "#f2b24b", font: "system" },
};

function build(): string {
  const outDir = join(mkdtempSync(join(tmpdir(), "guide-")), "app");
  assemble({
    buildId: "b-1",
    recipesDir,
    recipe: "storefront",
    outDir,
    spec,
    selected: [],
    gaps: [],
  });
  return outDir;
}

describe("agent-ready package (S9/S10)", () => {
  it("ships AGENTS.md, CLAUDE.md and turbineh.json with the map an agent needs", () => {
    const dir = build();
    const guide = JSON.parse(readFileSync(join(dir, "turbineh.json"), "utf8")) as PackageGuide;
    expect(guide.schema).toBe("turbineh.package/v1");
    expect(guide.status).toBe("unverified");
    expect(guide.criteria.map((c) => c.status)).toEqual(["unverified", "unverified", "unverified"]);
    const paths = guide.files.flatMap((a) => a.files.map((f) => f.path));
    expect(paths).toContain("src/server/stripe.ts");
    expect(paths).toContain("src/app/api/stripe/webhook/route.ts");
    expect(guide.env.required.map((e) => e.name)).toEqual(
      expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET", "ADMIN_EMAILS"]),
    );
    expect(guide.env.optional.map((e) => e.name)).toContain("STRIPE_SECRET_KEY");
    expect(guide.theme.tokens["color-surface"]).toBe("#001a5a");
    expect(guide.extend.map((e) => e.what)).toContain("Call a new external service");
    expect(guide.tests.some((t) => t.file === "tests/e2e/shop.spec.ts")).toBe(true);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    const md = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("## What is left");
    expect(md).toContain("## What to re-run after a change");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("[AGENTS.md](AGENTS.md)");
  });

  it("after verification marks each criterion met (with its test) or open (with where to implement it)", () => {
    const dir = build();
    const title = (readFileSync(join(dir, "tests/e2e/shop.spec.ts"), "utf8").match(
      /test\(\s*"(buys an option[^"]+)"/,
    ) ?? [])[1] as string;
    const guide = verifiedGuide(dir, {
      gate: {
        ok: true,
        verifiedAt: "2026-10-12T00:00:00.000Z",
        environment: "sandbox",
        steps: [{ name: "e2e", ok: true, ms: 1000 }],
        findings: [],
      },
      criteria: [
        {
          criterion: spec.acceptance_criteria[0] as string,
          evidence:
            "End-to-end test: the admin adds a product with an https image URL; shoppers find it by its description",
          verified: true,
        },
        {
          criterion: spec.acceptance_criteria[1] as string,
          evidence: `End-to-end test: ${title}`,
          verified: true,
        },
        {
          criterion: spec.acceptance_criteria[2] as string,
          evidence: "Not verified",
          verified: false,
        },
      ],
    });
    expect(guide?.status).toBe("verified");
    expect(guide?.criteria[0]).toMatchObject({
      status: "met",
      test: { file: "tests/e2e/shop.spec.ts" },
    });
    expect(guide?.criteria[1]?.status).toBe("met");
    expect(guide?.criteria[2]?.status).toBe("open");
    expect(guide?.criteria[2]?.where?.length).toBeGreaterThan(0);
    expect(guide?.left).toEqual([expect.objectContaining({ kind: "criterion" })]);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("**open**");
  });

  it("reads one-line descriptions and ranks files for open criteria deterministically", () => {
    expect(
      aboutOf('import x from "y";\n/** Stripe Checkout (hosted page). More text. */\nexport {}'),
    ).toBe("Stripe Checkout (hosted page).");
    expect(
      whereFor("Shoppers can review products", [
        {
          area: "a",
          files: [
            { path: "src/app/shop/[slug]/page.tsx", about: "page /shop/[slug] — product page" },
            { path: "src/lib/csv.ts", about: "CSV" },
          ],
        },
      ]),
    ).toEqual(["src/app/shop/[slug]/page.tsx"]);
    expect(existsSync(recipesDir)).toBe(true);
  });
});
