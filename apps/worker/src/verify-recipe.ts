/**
 * `pnpm --filter @turbineh/worker run verify:recipe <recipe> ["<prompt>"]` — assembles one recipe template with a
 * minimal spec (no models involved) and runs the full verification gate on it in the local sandbox. Used to check
 * catalogue templates before they ship; prints the gate steps and findings as JSON.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "@turbineh/assembler";
import { extractPalette, type BuildSpec } from "@turbineh/compiler";
import { gateFindings, verify } from "@turbineh/verifier";

const [recipe = "saas-crud", prompt = ""] = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(mkdtempSync(join(tmpdir(), `recipe-${recipe}-`)), "app");
const spec: BuildSpec = {
  recipe: recipe as BuildSpec["recipe"],
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Recipe Check",
  slug: "recipe-check",
  summary: `Verification of the ${recipe} recipe template.`,
  roles: ["owner"],
  entities: [],
  pages: [{ path: "/", purpose: "Home", auth_required: false }],
  capabilities: ["security.headers", "data.validation"],
  acceptance_criteria: [
    "Owner signs in and reaches the dashboard",
    "Anonymous users are sent to sign-in",
    "Every action checks the workspace",
  ],
  site: null,
  palette: extractPalette(prompt),
};
assemble({
  buildId: "recipe-check",
  recipesDir: join(repoRoot, "catalog/recipes"),
  recipe,
  outDir,
  spec,
  selected: [],
  gaps: [],
});
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", ...args], {
    cwd: outDir,
    stdio: "pipe",
  });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "recipe check");
const r = await verify(outDir);
console.log(
  JSON.stringify(
    {
      recipe,
      outDir,
      ok: r.ok,
      steps: r.steps.map((s) => ({
        name: s.name,
        ok: s.ok,
        ms: s.ms,
        ...(s.ok ? {} : { detail: s.detail.slice(-2500) }),
      })),
      findings: gateFindings(r),
    },
    null,
    2,
  ),
);
process.exitCode = r.ok ? 0 : 1;
