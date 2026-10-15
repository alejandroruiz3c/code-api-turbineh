import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { recipeChain } from "./recipes.js";

const recipesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog/recipes");
type Pkg = { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const pkgOf = (id: string) =>
  JSON.parse(readFileSync(join(recipesDir, id, "template/package.json"), "utf8")) as Pkg;

describe("recipes that ship their own package.json", () => {
  const overlays = readdirSync(recipesDir).filter(
    (id) =>
      recipeChain(recipesDir, id).length > 1 &&
      existsSync(join(recipesDir, id, "template/package.json")),
  );

  it("exist only with their own lockfile", () => {
    for (const id of overlays)
      expect(existsSync(join(recipesDir, id, "template/pnpm-lock.yaml"))).toBe(true);
  });

  it("keep every dependency of their base recipe at the same exact version", () => {
    for (const id of overlays) {
      const base = pkgOf(recipeChain(recipesDir, id)[0]?.id ?? "");
      const own = pkgOf(id);
      expect({ id, deps: own.dependencies }).toMatchObject({ id, deps: base.dependencies });
      expect({ id, dev: own.devDependencies }).toMatchObject({ id, dev: base.devDependencies });
    }
  });

  it("include the AI recipe", () => {
    expect(overlays).toContain("ai-agents");
  });
});
