/**
 * `pnpm --filter @turbineh/worker run verify:recipe <recipe> ["<prompt>"] [--with <component,…>] [--local-db]
 * [--assemble-only] [--quick] | --all [--domains] [--quick] | --list`
 *
 * Assembles a recipe the way the pipeline does (ADR-0037 §D4) — its required components, the domain components the
 * prompt selects (e.g. ai-agents + domain.bookings for a booking request), native components for its capabilities —
 * with a minimal spec (no models involved), then runs the verification gate in the local sandbox and prints the steps
 * and findings as JSON.
 *  - `--all`: every combination (each recipe alone, plus each recipe a domain component applies to) — the full E2E gate
 *    to run before merging a catalog or assembler change.
 *  - `--quick`: lint + typecheck + unit only (sandbox `quickCheck`). On CI (`CI=true`: an ephemeral runner without
 *    secrets) it runs typecheck + unit directly in the assembled app instead.
 *  - `--local-db`: no Postgres container and no DATABASE_URL for migrations and E2E (the package's zero-setup database
 *    must carry them). `--assemble-only`: print the assembled directory and stop. `--list`: print the combinations.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateFailures,
  gateFindings,
  quickCheck,
  verify,
  type VerifyResult,
} from "@turbineh/verifier";
import { assembleCombination, combinations, type Combination } from "./combinations.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  if (at >= 0) argv.splice(at, 1);
  return at >= 0;
};
const localDb = flag("--local-db");
const assembleOnly = flag("--assemble-only");
const quick = flag("--quick");
const all = flag("--all");
const list = flag("--list");
const onlyDomains = flag("--domains");
const withAt = argv.indexOf("--with");
// --with id1,id2: extra native catalog components (files/) vendored into the app, as a build that selected them would.
const withIds = withAt >= 0 ? (argv.splice(withAt, 2)[1] ?? "").split(",").filter(Boolean) : [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** CI runners are ephemeral and hold no secrets: the quick check may run there without the sandbox container. */
function quickOnRunner(dir: string): VerifyResult {
  const run = (name: "install" | "typecheck" | "unit", cmd: string[]) => {
    const t = performance.now();
    try {
      execFileSync("pnpm", cmd, { cwd: dir, stdio: "pipe", env: { ...process.env, CI: "true" } });
      return { name, ok: true, ms: Math.round(performance.now() - t), detail: "" };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const detail = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.slice(-6000);
      return { name, ok: false, ms: Math.round(performance.now() - t), detail };
    }
  };
  const install = run("install", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  const steps = install.ok
    ? [install, run("typecheck", ["-s", "typecheck"]), run("unit", ["-s", "test"])]
    : [install];
  return {
    ok: steps.every((s) => s.ok),
    steps,
    findings: { secrets: 0, advisories: [], licenses: [], static: [] },
    scannedAt: new Date().toISOString(),
  };
}

async function check(c: Combination) {
  const outDir = join(mkdtempSync(join(tmpdir(), `recipe-${c.recipe}-`)), "app");
  const assembled = assembleCombination(repoRoot, c, outDir, withIds);
  if (assembleOnly) return { name: c.name, outDir, ok: true, ...assembled };
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", ...args], {
      cwd: outDir,
      stdio: "pipe",
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "recipe check");
  const r = quick
    ? process.env.CI === "true"
      ? quickOnRunner(outDir)
      : await quickCheck(outDir)
    : await verify(outDir, { localDb });
  return {
    name: c.name,
    recipe: c.recipe,
    outDir,
    mode: quick ? "quick" : "full",
    localDb,
    ...assembled,
    ok: r.ok,
    checks: `${r.steps.filter((s) => s.ok).length}/${r.steps.length}`,
    steps: r.steps.map((s) => ({
      name: s.name,
      ok: s.ok,
      ms: s.ms,
      ...(s.ok ? {} : { detail: s.detail.slice(-2500) }),
    })),
    failures: gateFailures(r),
    findings: gateFindings(r),
  };
}

const known = combinations(repoRoot);
if (list) {
  console.log(JSON.stringify(known, null, 2));
  process.exit(0);
}
let targets: Combination[];
// --all --domains: only recipes assembled together with a domain component (the CI quick check).
if (all) targets = onlyDomains ? known.filter((k) => k.name.includes("+")) : known;
else {
  const [name = "saas-crud", prompt = ""] = argv;
  // A combination name ("ai-agents+domain.bookings.turbineh") or a recipe with an optional prompt.
  const named = known.find((k) => k.name === name);
  targets = [
    named && !prompt
      ? named
      : {
          name,
          recipe: name.split("+")[0] ?? name,
          prompt: prompt || "",
          with: name.split("+").slice(1),
        },
  ];
}
const results = [];
for (const t of targets) results.push(await check(t));
console.log(JSON.stringify(targets.length === 1 ? results[0] : results, null, 2));
if (targets.length > 1) {
  for (const r of results)
    console.error(`${r.ok ? "PASS" : "FAIL"} ${r.name}${"checks" in r ? ` ${r.checks}` : ""}`);
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
