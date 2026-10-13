import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRecipes, checkTree } from "./agent-ready.js";

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
      "guide-path-missing recipes/shop/recipe.yaml",
    ]);
  });
});
