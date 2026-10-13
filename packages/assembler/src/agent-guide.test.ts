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
      expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET"]),
    );
    // Allow-lists are optional at build time and deny by default at runtime (ADR-0035).
    expect(guide.env.required.map((e) => e.name)).not.toContain("ADMIN_EMAILS");
    expect(guide.env.optional.map((e) => e.name)).toEqual(
      expect.arrayContaining(["STRIPE_SECRET_KEY", "ADMIN_EMAILS"]),
    );
    expect(guide.theme.tokens["color-surface"]).toBe("#001a5a");
    expect(guide.extend.map((e) => e.what)).toContain("Call a new external service");
    expect(guide.tests.some((t) => t.file === "tests/e2e/shop.spec.ts")).toBe(true);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    const md = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("## What is left");
    expect(md).toContain("## What to re-run after a change");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("[AGENTS.md](AGENTS.md)");
  });

  it("documents the blessed helpers, the settings pattern and the local gate (learning round G4)", () => {
    const dir = build();
    const guide = JSON.parse(readFileSync(join(dir, "turbineh.json"), "utf8")) as PackageGuide;
    const ext = (what: RegExp) => guide.extend.find((e) => what.test(e.what));
    expect(ext(/^Add a public action/)?.how).toMatch(/publicAction\("<name>", \{ rateLimit/);
    expect(ext(/^Add an action for signed-in non-members/)?.how).toContain(
      "await requireSession()",
    );
    expect(ext(/^Add a setting or secret/)?.how).toMatch(/no secret-shaped literal/);
    const handover = guide.rerun.find((r) => r.change.startsWith("Before handing over"));
    expect(handover?.note).toContain("publicAction()");
    const md = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("| Add a public action");
    // The helpers the guide names exist in the package.
    const authz = readFileSync(join(dir, "src/server/authz.ts"), "utf8");
    expect(authz).toContain("export function publicAction");
    expect(authz).toContain("export async function requireSession");
  });

  it("after verification marks each criterion met (with its test) or open (with where to implement it)", () => {
    const dir = build();
    const title = (readFileSync(join(dir, "tests/e2e/shop.spec.ts"), "utf8").match(
      /test\(\s*"(pays with Stripe Checkout[^"]+)"/,
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

  it("a failed gate: delivered, not verified, with the exact failure and fix first (ADR-0037)", () => {
    const dir = build();
    const failure = {
      step: "e2e",
      test: "shop › the admin updates a product's stock",
      where: "tests/e2e/shop.spec.ts:120",
      owner: "recipe:storefront",
      message: "Error: expect(locator).toHaveText(expected) failed",
      rerun: 'pnpm test:e2e tests/e2e/shop.spec.ts -g "the admin updates a product\'s stock"',
      fix: "Reproduce with `pnpm test:e2e …`. Fix the code it exercises.",
    };
    const guide = verifiedGuide(dir, {
      gate: {
        ok: false,
        verifiedAt: "2026-10-13T00:00:00.000Z",
        environment: "sandbox",
        steps: [
          { name: "unit", ok: true, ms: 1 },
          { name: "e2e", ok: false, ms: 1 },
        ],
        findings: [
          {
            category: "quality",
            rule: "e2e",
            where: "tests/e2e/shop.spec.ts:120",
            blocking: true,
            message: "e2e failed",
          },
        ],
      },
      criteria: [],
      failures: [failure],
    });
    expect(guide).toMatchObject({ status: "failed", verified: false, checks: "1/2" });
    expect(guide?.failures).toEqual([failure]);
    // The failure (with its fix) replaces the generic quality finding in "What is left".
    expect(guide?.left.filter((l) => l.kind === "gate")).toEqual([
      {
        kind: "gate",
        what: `NOT VERIFIED · e2e · "${failure.test}": ${failure.message}`,
        where: failure.where,
        how: failure.fix,
      },
    ]);
    const md = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("**Delivered, not verified: 1/2 checks passed**");
    expect(md).toContain("Do not treat it as verified");
    expect(md).not.toContain("**Verified**");
    const json = JSON.parse(readFileSync(join(dir, "turbineh.json"), "utf8")) as PackageGuide;
    expect(json.verified).toBe(false);
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
