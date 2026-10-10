import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assemble,
  hasRecipe,
  mergedRecipe,
  recipeChain,
  writeReports,
  type SelectedComponent,
} from "@turbineh/assembler";
import { compileIntent, type CompilerConfig } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import { resolveSet, type Stack } from "@turbineh/resolver";
import { selectComponents } from "@turbineh/selector";
import { verify, type VerifyResult } from "@turbineh/verifier";
import { candidatesFor, loadCatalog } from "./catalog-source.js";

export type Phase =
  | "compiling"
  | "selecting"
  | "resolving"
  | "assembling"
  | "verifying"
  | "delivering"
  | "done"
  | "failed";

export interface PipelineDeps {
  repoRoot: string;
  buildsDir: string;
  compiler: CompilerConfig;
  decider: Decider;
  emit: (
    buildId: string,
    phase: Phase,
    type: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
}

export interface BuildOutcome {
  buildId: string;
  status: "done" | "failed";
  repoDir?: string;
  metrics: Record<string, unknown>;
  verify?: VerifyResult;
  reason?: string;
}

const git = (dir: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=CODE-API-TURBINEH", "-c", "user.email=builds@turbineh.com", ...args],
    {
      cwd: dir,
      stdio: "pipe",
    },
  );

export async function runBuild(prompt: string, deps: PipelineDeps): Promise<BuildOutcome> {
  const buildId = randomUUID();
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));

  // 1 · compile (decider batch + small parts)
  let t = performance.now();
  await deps.emit(buildId, "compiling", "start", { prompt });
  const compiled = await compileIntent(prompt, deps.compiler, deps.decider);
  lap("compile", t);
  await deps.emit(buildId, "compiling", "done", {
    ok: compiled.ok,
    decisions: compiled.decisions,
    usage: compiled.usage,
  });
  if (!compiled.ok || !compiled.spec) {
    return { buildId, status: "failed", reason: "BuildSpec invalid (T5)", metrics: { timings } };
  }
  const spec = compiled.spec;
  if (spec.recipe === "out_of_scope") {
    return {
      buildId,
      status: "failed",
      reason: `out of scope for the beta: ${spec.out_of_scope_reason ?? ""} (closest recipe: ${spec.closest_recipe ?? "none"})`,
      metrics: { timings },
    };
  }
  const recipesDir = join(deps.repoRoot, "catalog/recipes");
  // Families without their own recipe yet fall back to the multi-tenant CRUD base (recorded in metrics).
  const recipeId = hasRecipe(recipesDir, spec.recipe) ? spec.recipe : "saas-crud";
  const recipe = mergedRecipe(recipeChain(recipesDir, recipeId));
  // Recipe defaults are added by code, never left to the model.
  spec.capabilities = [
    ...new Set([...spec.capabilities, ...recipe.defaultCapabilities]),
  ] as typeof spec.capabilities;

  // 2 · select (one batched decider request for the whole build)
  t = performance.now();
  const catalog = loadCatalog(join(deps.repoRoot, "catalog/components"));
  const selection = await selectComponents(
    {
      app: {
        recipe: spec.recipe,
        summary: spec.summary,
        acceptance_criteria: spec.acceptance_criteria,
      },
      candidates: candidatesFor(spec.capabilities, catalog),
    },
    deps.decider,
  );
  lap("select", t);
  await deps.emit(buildId, "selecting", "done", {
    decider: selection.decider,
    decisions: selection.decisions.map((d) => ({
      capability: d.capability,
      best: d.best,
      trigger: d.trigger,
      covers: d.covers,
      risk: d.risk,
    })),
  });

  // 3 · resolve (deterministic)
  t = performance.now();
  const baseTemplate = join(
    recipesDir,
    recipeChain(recipesDir, recipeId)[0]?.id ?? recipeId,
    "template",
  );
  const pkg = JSON.parse(readFileSync(join(baseTemplate, "package.json"), "utf8")) as {
    dependencies: Stack;
    devDependencies: Stack;
  };
  const stack: Stack = { ...pkg.dependencies, ...pkg.devDependencies };
  const ranked = Object.fromEntries(selection.decisions.map((d) => [d.capability, d.ranked]));
  const resolution = resolveSet(ranked, stack);
  lap("resolve", t);
  const triggers = Object.fromEntries(selection.decisions.map((d) => [d.capability, d.trigger]));
  const gaps = resolution.gaps.map((capability) => ({
    capability,
    trigger: triggers[capability] ?? "T1",
  }));
  await deps.emit(buildId, "resolving", "done", {
    selected: Object.fromEntries(Object.entries(resolution.selected).map(([k, c]) => [k, c.id])),
    rejected: resolution.rejected,
    gaps,
  });

  // 4 · assemble
  t = performance.now();
  const repoDir = join(deps.buildsDir, buildId, spec.slug);
  const decisionOf = (cap: string) => selection.decisions.find((d) => d.capability === cap);
  const selected: SelectedComponent[] = Object.entries(resolution.selected).map(
    ([capability, component]) => {
      const d = decisionOf(capability);
      return {
        capability,
        component,
        why: {
          pBest: d?.best?.p ?? 0,
          covers: d?.covers[component.id] ?? 0,
          risk: d?.risk[component.id] ?? 0,
        },
      };
    },
  );
  const assembled = assemble({
    buildId,
    recipesDir,
    recipe: recipeId,
    outDir: repoDir,
    spec,
    selected,
    gaps,
  });
  git(repoDir, "init", "-q", "-b", "main");
  git(repoDir, "add", "-A");
  git(
    repoDir,
    "commit",
    "-q",
    "-m",
    `feat: ${spec.app_name} assembled by CODE-API-TURBINEH (build ${buildId})`,
  );
  lap("assemble", t);
  await deps.emit(buildId, "assembling", "done", {
    generatedLines: assembled.generatedLines,
    reusedLines: assembled.reusedLines,
    files: assembled.files.length,
  });

  // 5 · verify (sandbox)
  t = performance.now();
  await deps.emit(buildId, "verifying", "start", {});
  const result = await verify(repoDir);
  lap("verify", t);
  await deps.emit(buildId, "verifying", "done", {
    ok: result.ok,
    steps: result.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms })),
  });

  // 6 · deliver locally (channel A artefact on disk): reports + final commit
  const metrics = {
    timings: { ...timings, total: Math.round(performance.now() - t0) },
    tokens: { compiler: compiled.usage, decider: "input-only, counted by the provider" },
    decider: selection.decider,
    reuse: {
      generatedLines: assembled.generatedLines,
      reusedLines: assembled.reusedLines,
      reusedShare: +(
        assembled.reusedLines / Math.max(1, assembled.reusedLines + assembled.generatedLines)
      ).toFixed(3),
    },
    recipe: { requested: spec.recipe, built: recipeId },
    components: [...new Set(selected.map((s) => s.component.id))],
    gaps,
  };
  writeReports(
    repoDir,
    securityReport(result),
    turbinehReport(buildId, spec.app_name, metrics, result),
  );
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-q", "-m", "docs: security report and build report");
  await deps.emit(buildId, result.ok ? "done" : "failed", "done", { repoDir, metrics });
  return { buildId, status: result.ok ? "done" : "failed", repoDir, metrics, verify: result };
}

function securityReport(v: VerifyResult): string {
  const row = (n: string) => {
    const s = v.steps.find((x) => x.name === n);
    return s ? (s.ok ? "pass" : "FAIL") : "not run";
  };
  return `# Security report

- Date: ${v.scannedAt}
- Scope: this repository at the commit that contains this file, its lockfile (direct and transitive npm dependencies)
  and the running app in an isolated network.

| Check | Tool | Result |
|---|---|---|
| Secrets in git history | gitleaks | ${row("secrets")} |
| Known vulnerabilities (direct + transitive) | OSV database | ${row("dependencies")} (${v.findings.advisories.length} advisories) |
| Licenses (copyleft / unlicensed blocked) | installed package metadata | ${row("licenses")} |
| Type safety | TypeScript strict | ${row("typecheck")} |
| Lint | ESLint | ${row("lint")} |
| Unit tests (security headers, rate limit, role policy) | Vitest | ${row("unit")} |
| End-to-end smoke (sign-up, authz redirect, CRUD) | Playwright | ${row("e2e")} |

${v.findings.advisories.length ? `## Advisories\n\n${v.findings.advisories.map((a) => `- ${a.id} · ${a.pkg} · ${a.severity}`).join("\n")}\n` : ""}
## Not checked

- Static analysis with custom Semgrep rules (planned).
- Penetration testing, load testing and infrastructure configuration of your deployment.
- Business-logic authorization beyond the role policy in \`src/server/authz.ts\`.

This report is not a statement that the software is "secure"; it lists what was checked, when and with what result.
`;
}

function turbinehReport(
  buildId: string,
  name: string,
  metrics: Record<string, unknown>,
  v: VerifyResult,
): string {
  return `# Build report · ${name}

- Build: \`${buildId}\`
- Verification: **${v.ok ? "green" : "red"}** (${v.steps.map((s) => `${s.name} ${s.ok ? "✓" : "✗"}`).join(", ")})

\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`
`;
}
