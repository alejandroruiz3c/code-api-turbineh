import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPackage, checkRecipes, checkTree, requiredEnvVars } from "./agent-ready.js";

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-ready-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const rules = (dir: string) => checkTree("t", dir).map((i) => i.rule);

describe("agent-ready admission checks", () => {
  it("rejects hard-coded surfaces, secret-shaped literals, old tsconfig, unmocked services, undocumented routes", () => {
    const secret = ["whsec", "abcdef0123456789"].join("_");
    const dir = tree({
      "src/components/card.tsx":
        'export const C = () => <div className="bg-white text-slate-600" />;\n',
      "playwright.config.ts": `process.env.STRIPE_WEBHOOK_SECRET = "${secret}";\n`,
      "tsconfig.json": '{ "include": ["next-env.d.ts", ".next/types/**/*.ts"] }\n',
      "src/server/pay.ts":
        'export const pay = () => fetch(`${process.env.ACME_API_BASE}/v1/pay`, { method: "POST" });\n',
      "src/app/shop/page.tsx": "export default function Shop() { return null; }\n",
    });
    expect(rules(dir).sort()).toEqual([
      "hard-coded-colour",
      "next-dev-types",
      "route-without-doc",
      "secret-shaped-literal",
      "service-without-mock",
    ]);
  });

  it("accepts tokens, runtime secrets, a shipped mock and documented routes", () => {
    const dir = tree({
      "src/components/card.tsx":
        'export const C = () => <div className="bg-panel text-muted" />;\n',
      "playwright.config.ts": 'process.env.STRIPE_WEBHOOK_SECRET ||= `whsec_${"x".repeat(2)}`;\n',
      "tsconfig.json": '{ "include": [".next/types/**/*.ts", ".next/dev/types/**/*.ts"] }\n',
      "src/server/pay.ts":
        'export const pay = () => fetch(`${process.env.ACME_API_BASE}/v1/pay`, { method: "POST" });\n',
      "tests/e2e/mocks/ACME_API_BASE.mjs": "// mock\n",
      "src/app/shop/page.tsx":
        "/** Catalogue. */\nexport default function Shop() { return null; }\n",
    });
    expect(rules(dir)).toEqual([]);
  });

  it("requires recipe guide inputs that point at real files", () => {
    const dir = tree({
      "base/recipe.yaml": "id: base\nextends: null\n",
      "base/template/src/app/page.tsx":
        "/** Home. */\nexport default function H() { return null; }\n",
      "shop/recipe.yaml":
        'id: shop\nextends: base\nguide:\n  extend:\n    - { what: "Add a field", where: "src/app/page.tsx and src/lib/missing.ts", how: "x" }\n',
      "shop/template/src/lib/ok.ts": "export {};\n",
    });
    expect(checkRecipes(dir).map((i) => `${i.rule} ${i.where}`)).toEqual([
      "guide-missing recipes/base/recipe.yaml",
      "acceptance-missing recipes/base/acceptance.yaml",
      "guide-path-missing recipes/shop/recipe.yaml",
      "acceptance-missing recipes/shop/acceptance.yaml",
    ]);
  });

  it("zero friction: local database scripts, optional allow-lists, documented required env, E2E-owned URLs", () => {
    const bad = tree({
      "package.json": JSON.stringify({
        scripts: {
          "test:e2e": "playwright test",
          "db:migrate": "tsx scripts/migrate.ts",
          dev: "next dev",
        },
        devDependencies: { "embedded-postgres": "^17.0.0" },
      }),
      "src/env.ts":
        "const schema = z.object({\n  DATABASE_URL: z.string().min(1),\n  ADMIN_EMAILS: z.string().min(3),\n  STRIPE_KEY: z.string().optional(),\n});\n",
      ".env.example": "DATABASE_URL=x\n",
      "playwright.config.ts":
        "const port = Number(process.env.PORT ?? 3000);\nprocess.env.BETTER_AUTH_URL ||= `http://127.0.0.1:${port}`;\n",
    });
    expect(checkPackage("t", [bad]).map((i) => i.rule)).toEqual([
      "local-db-missing",
      "required-allow-list",
      "required-env-undocumented",
      "e2e-ambient-url",
    ]);
    const good = tree({
      "package.json": JSON.stringify({
        scripts: {
          dev: "tsx scripts/local-db.ts --run --migrate -- next dev",
          "test:e2e": "tsx scripts/local-db.ts --run --fresh --migrate -- playwright test",
          "db:migrate": "tsx scripts/local-db.ts --run -- tsx scripts/migrate.ts",
          "db:local": "tsx scripts/local-db.ts --serve",
        },
        devDependencies: {
          "embedded-postgres": "17.10.0-beta.17",
          "@electric-sql/pglite": "0.5.8",
          "@electric-sql/pglite-pgvector": "0.0.9",
          "@electric-sql/pglite-socket": "0.2.11",
        },
      }),
      "scripts/local-db.ts": "export {};\n",
      "src/env.ts":
        'const schema = z.object({\n  DATABASE_URL: z.string().min(1),\n  ADMIN_EMAILS: z.string().default(""),\n});\n',
      ".env.example": "DATABASE_URL=x\n",
      "playwright.config.ts": "process.env.BETTER_AUTH_URL = origin;\n",
    });
    expect(checkPackage("t", [good])).toEqual([]);
    expect(
      requiredEnvVars(
        '  A_URL: z.url(),\n  B: z.string().default(""),\n  NODE_ENV: z.enum(["x"]),\n',
      ),
    ).toEqual(["A_URL"]);
  });

  it("acceptance rules must point at tests the recipe ships (file › exact title)", () => {
    const dir = tree({
      "base/recipe.yaml":
        'id: base\nextends: null\nguide:\n  extend:\n    - { what: "x", where: "y", how: "z" }\n',
      "base/acceptance.yaml":
        '- test: "tests/e2e/a.spec.ts › signs in"\n  covers: ["sign"]\n- test: "tests/e2e/a.spec.ts › does not exist"\n  covers: ["x"]\n- test: "tests/e2e/a.spec.ts › signs in"\n  covers: ["("]\n',
      "base/template/tests/e2e/a.spec.ts": 'test("signs in", async () => {});\n',
    });
    expect(
      checkRecipes(dir)
        .filter((i) => i.rule.startsWith("acceptance"))
        .map((i) => i.message.slice(0, 30)),
    ).toEqual(['"tests/e2e/a.spec.ts › does no', 'Rule "tests/e2e/a.spec.ts › si']);
  });
});
