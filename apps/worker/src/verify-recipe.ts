/**
 * `pnpm --filter @turbineh/worker run verify:recipe <recipe> ["<prompt>"] [--with <component,…>] [--local-db]
 * [--assemble-only]` — assembles one recipe template with a minimal spec (no models involved) and runs the full
 * verification gate on it in the local sandbox. Used to check catalogue templates before they ship; prints the gate
 * steps and findings as JSON. `--local-db`: no Postgres container and no DATABASE_URL for migrations and E2E (the
 * package's zero-setup database must carry them). `--assemble-only`: print the assembled directory and stop. Domain
 * components the prompt names (e.g. bookings, ADR-0033) are detected by code and assembled as a build would.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "@turbineh/assembler";
import { detectDomains, extractPalette, type BuildSpec } from "@turbineh/compiler";
import { gateFindings, verify } from "@turbineh/verifier";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  if (at >= 0) argv.splice(at, 1);
  return at >= 0;
};
const localDb = flag("--local-db");
const assembleOnly = flag("--assemble-only");
const withAt = argv.indexOf("--with");
// --with id1,id2: native catalog components (files/) vendored into the app, as a build that selected them would.
const withIds = withAt >= 0 ? (argv.splice(withAt, 2)[1] ?? "").split(",").filter(Boolean) : [];
const [recipe = "saas-crud", prompt = ""] = argv;
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
// Domain components named by the prompt (detected by code, as in a build): their component joins the selection.
const domains = prompt ? detectDomains(prompt, recipe, spec.app_name) : [];
for (const d of domains) if (!withIds.includes(d.component)) withIds.push(d.component);
assemble({
  buildId: "recipe-check",
  domains,
  recipesDir: join(repoRoot, "catalog/recipes"),
  recipe,
  outDir,
  spec,
  selected: withIds.map((id) => ({
    capability: id.split(".").slice(0, 2).join("."),
    component: {
      id,
      pkg: { name: `turbineh/${id}`, version: "1.0.0" },
      license: { detected: "Apache-2.0" },
    } as never,
    why: { pBest: 1, covers: 1, risk: 0 },
  })),
  gaps: [],
});
if (assembleOnly) {
  console.log(outDir);
  process.exit(0);
}
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", ...args], {
    cwd: outDir,
    stdio: "pipe",
  });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "recipe check");
const r = await verify(outDir, { localDb });
console.log(
  JSON.stringify(
    {
      recipe,
      outDir,
      localDb,
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
