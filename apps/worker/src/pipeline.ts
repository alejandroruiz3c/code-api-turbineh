import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assemble,
  hasRecipe,
  mergedRecipe,
  recipeChain,
  type SelectedComponent,
} from "@turbineh/assembler";
import { compileIntent, type CompilerConfig } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import { resolveSet, type Stack } from "@turbineh/resolver";
import { CAPABILITY_LABELS, selectComponents } from "@turbineh/selector";
import type { FixerSlot } from "@turbineh/remediation";
import type { WriterConfig } from "@turbineh/reporter";
import type { VerifyResult } from "@turbineh/verifier";
import { finalize, type FinalizeDeps } from "./finalize.js";
import { candidatesFor, loadCatalog } from "./catalog-source.js";

export type Phase =
  | "compiling"
  | "selecting"
  | "resolving"
  | "assembling"
  | "verifying"
  | "remediating"
  | "reporting"
  | "delivering"
  | "done"
  | "failed";

export interface PipelineDeps {
  repoRoot: string;
  buildsDir: string;
  compiler: CompilerConfig;
  decider: Decider;
  fixers: FixerSlot[];
  writer: WriterConfig;
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
  spec?: unknown;
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

export async function runBuild(
  prompt: string,
  deps: PipelineDeps,
  buildId: string = randomUUID(),
): Promise<BuildOutcome> {
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
  if (compiled.rejected) {
    return {
      buildId,
      status: "failed",
      reason: compiled.rejected,
      metrics: { timings, abuse: compiled.decisions?.abuse },
    };
  }
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
  // Policy (code): among eligible candidates, components the recipe already integrates come first; the
  // decider's order is kept within each group. External libraries wait for WP10 integration.
  const native = (c: { pkg: { name: string } }) =>
    c.pkg.name.startsWith("turbineh/") || c.pkg.name in stack;
  const ranked = Object.fromEntries(
    selection.decisions.map((d) => [
      d.capability,
      [...d.ranked.filter(native), ...d.ranked.filter((c) => !native(c))],
    ]),
  );
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
  // A component counts as used only if the recipe can integrate it today: vendored in the recipe, or its
  // package is already in the recipe's verified lockfile. Others wait for WP10 (install + glue) and are
  // reported as "selected, integration pending", never claimed as used.
  const integrable = (c: { pkg: { name: string } }) =>
    c.pkg.name.startsWith("turbineh/") || c.pkg.name in stack;
  const pendingIntegration = Object.entries(resolution.selected)
    .filter(([, c]) => !integrable(c))
    .map(([capability, c]) => ({ capability, component: c.id }));
  const selected: SelectedComponent[] = Object.entries(resolution.selected)
    .filter(([, c]) => integrable(c))
    .map(([capability, component]) => {
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
    });
  const gapsWithPending = [
    ...gaps,
    ...pendingIntegration.map((p) => ({
      capability: p.capability,
      trigger: `integration pending: ${p.component}`,
    })),
  ];
  const assembled = assemble({
    buildId,
    recipesDir,
    recipe: recipeId,
    outDir: repoDir,
    spec,
    selected,
    gaps: gapsWithPending,
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

  // 5 · verify → automatic security remediation → report (shared with "improve and redeliver")
  t = performance.now();
  const metrics: Record<string, unknown> = {
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
    pendingIntegration,
    gaps,
  };
  const fin = await finalize(
    {
      buildId,
      repoDir,
      scope: "auto",
      facts: {
        appName: spec.app_name,
        summary: spec.summary,
        recipe: recipeId,
        entities: spec.entities.map((e) => e.name),
        acceptanceCriteria: spec.acceptance_criteria,
        components: selected.map((s) => ({ capability: s.capability, id: s.component.id })),
        gaps: gapsWithPending.map((g) => g.capability),
        gapLabels: CAPABILITY_LABELS,
        reusedShare: (metrics.reuse as { reusedShare: number }).reusedShare,
      },
      metrics: { ...metrics, timings },
    },
    finalizeDeps(deps, buildId),
  );
  lap("verify", t);
  const finalMetrics = {
    ...metrics,
    timings: { ...timings, total: Math.round(performance.now() - t0) },
    alerts: fin.alerts,
    remediation: fin.remediation,
    report: fin.report,
  };
  await deps.emit(buildId, fin.ok ? "done" : "failed", "done", {
    repoDir,
    alerts: fin.alerts.length,
    remediated: fin.remediation.length,
  });
  return {
    buildId,
    status: fin.ok ? "done" : "failed",
    repoDir,
    metrics: finalMetrics,
    verify: fin.verify,
    spec,
  };
}

/** Adapter from pipeline deps to finalize deps. */
function finalizeDeps(deps: PipelineDeps, buildId: string): FinalizeDeps {
  return {
    decider: deps.decider,
    fixers: deps.fixers,
    writer: deps.writer,
    ...(deps.compiler.reasoningEffort ? { reasoningEffort: deps.compiler.reasoningEffort } : {}),
    emit: (phase, type, data) => deps.emit(buildId, phase, type, data),
  };
}

/**
 * "Improve and redeliver": takes a delivered repository, runs the improve-scope remediation (everything, including
 * informational alerts) with full re-verification, and produces a new verified version.
 */
export async function improveBuild(
  repoDir: string,
  parent: {
    spec: {
      app_name: string;
      summary: string;
      entities: { name: string }[];
      acceptance_criteria: string[];
    };
    metrics: Record<string, unknown>;
  },
  deps: PipelineDeps,
  buildId: string,
): Promise<BuildOutcome> {
  const t0 = performance.now();
  const fin = await finalize(
    {
      buildId,
      repoDir,
      scope: "improve",
      facts: {
        appName: parent.spec.app_name,
        summary: parent.spec.summary,
        recipe: String((parent.metrics.recipe as { built?: string } | undefined)?.built ?? ""),
        entities: parent.spec.entities.map((e) => e.name),
        acceptanceCriteria: parent.spec.acceptance_criteria,
        components: [],
        gaps: ((parent.metrics.gaps as { capability: string }[] | undefined) ?? []).map(
          (g) => g.capability,
        ),
        reusedShare: null,
      },
      metrics: { improvedFrom: parent.metrics.buildId ?? null },
    },
    finalizeDeps(deps, buildId),
  );
  const metrics = {
    ...parent.metrics,
    timings: { verify: fin.verifyMs, total: Math.round(performance.now() - t0) },
    alerts: fin.alerts,
    remediation: fin.remediation,
    report: fin.report,
    improved: true,
    improvedFrom: parent.metrics.buildId ?? null,
  };
  await deps.emit(buildId, fin.ok ? "done" : "failed", "done", {
    repoDir,
    alerts: fin.alerts.length,
    remediated: fin.remediation.length,
  });
  return {
    buildId,
    status: fin.ok ? "done" : "failed",
    repoDir,
    metrics,
    verify: fin.verify,
    spec: parent.spec,
  };
}
