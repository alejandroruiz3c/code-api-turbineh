import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assemble,
  entitiesToGenerate,
  providedTables,
  fieldsOf,
  parseBrand,
  hasRecipe,
  mergedRecipe,
  recipeChain,
  referencedEntities,
  ruleFiles,
  type SelectedComponent,
} from "@turbineh/assembler";
import type { BackupCoder } from "@turbineh/backup-coder";
import { compileIntent, type CompilerConfig } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import { resolveSet, type Stack } from "@turbineh/resolver";
import {
  CAPABILITY_LABELS,
  selectComponents,
  selectionCacheKey,
  type SelectionResult,
} from "@turbineh/selector";
import type { FixerSlot } from "@turbineh/remediation";
import type { WriterConfig } from "@turbineh/reporter";
import {
  fillGap,
  integrateComponents,
  isFillable,
  rulesCapability,
  writeRules,
  type FilledGap,
  type IntegrationResult,
  type RuleTarget,
  type WrittenRules,
} from "@turbineh/integrator";
import { leakingFiles, type VerifyResult } from "@turbineh/verifier";
import { decideRules, type RuleCandidate } from "./business-rules.js";
import { finalize, type FinalizeDeps } from "./finalize.js";
import { candidatesFor, externalComponent, loadCatalog } from "./catalog-source.js";

export type Phase =
  | "compiling"
  | "selecting"
  | "resolving"
  | "assembling"
  | "integrating"
  | "verifying"
  | "correcting"
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
  /** Always connected (ADR-0003): fills gaps (T1/T2), writes business rules (T3), takes over corrections (T4). */
  backupCoder: BackupCoder;
  /** Catalog flywheel records (default: catalog/gaps under repoRoot). */
  gapsDir?: string;
  /** Selection cache (PLAN §9): same normalized spec + same candidates → same selection, no decider call. */
  selectionCache?: {
    get: (key: string) => Promise<SelectionResult | null>;
    put: (key: string, result: SelectionResult) => Promise<void>;
  };
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
  options: { brand?: unknown } = {},
): Promise<BuildOutcome> {
  // Client brand: validated again here (colour format, font list, logo type by magic bytes, size).
  const brand = parseBrand(options.brand);
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));

  // 1 · compile (decider batch + small parts)
  let t = performance.now();
  await deps.emit(buildId, "compiling", "start", { prompt });
  let compiled = await compileIntent(prompt, deps.compiler, deps.decider);
  // T5: the compiler model could not produce a valid BuildSpec after its retries → same decomposed process on the
  // Backup Coder's primary model (open weights), once.
  let t5: { model: string } | null = null;
  const backupSlot = deps.fixers[0];
  if (!compiled.ok && !compiled.rejected && backupSlot) {
    t5 = { model: backupSlot.model };
    await deps.emit(buildId, "compiling", "backup", { trigger: "T5", model: backupSlot.model });
    compiled = await compileIntent(
      prompt,
      {
        ...deps.compiler,
        baseURL: backupSlot.baseURL,
        apiKey: backupSlot.apiKey,
        model: backupSlot.model,
      },
      deps.decider,
    );
  }
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
  const selectionInput = {
    app: {
      recipe: spec.recipe,
      summary: spec.summary,
      acceptance_criteria: spec.acceptance_criteria,
    },
    candidates: candidatesFor(
      spec.capabilities.filter((c) => !recipe.providedCapabilities?.includes(c)),
      catalog,
    ),
  };
  const cacheKey = selectionCacheKey(selectionInput);
  const cached = await deps.selectionCache?.get(cacheKey).catch(() => null);
  const selection: SelectionResult = cached
    ? { ...cached, decider: { ...cached.decider, latencyMs: 0, requests: 0, cached: true } }
    : await selectComponents(selectionInput, deps.decider);
  if (!cached) await deps.selectionCache?.put(cacheKey, selection).catch(() => undefined);
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
  // Components the recipe already integrates (vendored or in its verified lockfile) go straight into assembly.
  // Other approved components are integrated after assembly (WP10): exact install, contract test, small glue.
  const integrable = (c: { pkg: { name: string } }) =>
    c.pkg.name.startsWith("turbineh/") || c.pkg.name in stack;
  const external = Object.entries(resolution.selected)
    .filter(([, c]) => !integrable(c))
    .map(([capability, c]) => ({ capability, component: c.id }));
  const whyOf = (capability: string, id: string) => {
    const d = decisionOf(capability);
    return { pBest: d?.best?.p ?? 0, covers: d?.covers[id] ?? 0, risk: d?.risk[id] ?? 0 };
  };
  const selected: SelectedComponent[] = Object.entries(resolution.selected).map(
    ([capability, component]) => ({ capability, component, why: whyOf(capability, component.id) }),
  );
  const assembled = assemble({
    buildId,
    recipesDir,
    recipe: recipeId,
    outDir: repoDir,
    spec,
    // Docs list only what is in the repository now; the integration step updates COMPONENTS.md when it succeeds.
    selected: selected.filter((x) => integrable(x.component)),
    brand,
    gaps: [
      ...gaps,
      ...external.map((e) => ({
        capability: e.capability,
        trigger: `integration pending: ${e.component}`,
      })),
    ],
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

  // 4b · integrate external components + Backup Coder fills (T1/T2), in parallel; swap point = assembled commit
  t = performance.now();
  const assembledCommit = git(repoDir, "rev-parse", "HEAD").toString().trim();
  // T3 (ADR-0023) runs in parallel with integration: decider batch → Backup Coder per entity. Files stay in memory
  // until the integration step has committed, so the two never race on the working tree.
  const rulesTask = businessRules(repoDir, spec, recipe, deps, buildId).catch(() => ({
    candidates: [] as RuleCandidate[],
    written: [] as WrittenRules[],
  }));
  const componentsDir = join(deps.repoRoot, "catalog/components");
  const label = (cap: string) => CAPABILITY_LABELS[cap] ?? cap;
  const toFill = gaps
    .filter((g) => isFillable(g.capability) && (g.trigger === "T1" || g.trigger === "T2"))
    .map((g) => ({
      capability: g.capability,
      label: label(g.capability),
      trigger: g.trigger as "T1" | "T2",
    }));
  let integrations: IntegrationResult[] = [];
  let filled: FilledGap[] = [];
  let integrationError: string | null = null;
  if (external.length > 0 || toFill.length > 0) {
    await deps.emit(buildId, "integrating", "start", {
      components: external.map((e) => e.component),
      gaps: toFill.map((g) => g.capability),
    });
    const [ints, fills] = await Promise.all([
      integrateComponents(
        repoDir,
        external.map((e) =>
          externalComponent(componentsDir, e.component, e.capability, label(e.capability)),
        ),
        deps.compiler,
      ).catch((err: unknown) => {
        integrationError = err instanceof Error ? err.message.slice(0, 300) : "integration failed";
        return [] as IntegrationResult[];
      }),
      Promise.all(
        toFill.map((g) =>
          fillGap(repoDir, g, deps.backupCoder, {
            buildId,
            summary: spec.summary,
            allowedImports: ["zod", ...Object.keys(pkg.dependencies)],
            gapsDir: deps.gapsDir ?? join(deps.repoRoot, "catalog/gaps"),
          }).catch(() => null),
        ),
      ),
    ]);
    integrations = ints;
    filled = fills.filter((f): f is FilledGap => f !== null);
    // Model-written files are scanned for secret-looking literals BEFORE they reach git history.
    const leaking = new Set(
      leakingFiles(repoDir, [
        ...integrations.flatMap((i) => (i.glue ? [i.glue] : [])),
        ...filled.flatMap((f) => [f.module, f.test]),
      ]),
    );
    if (leaking.size > 0) {
      for (const f of leaking) rmSync(join(repoDir, f), { force: true });
      integrations = integrations.map((i) =>
        i.glue && leaking.has(i.glue) ? { ...i, glue: null } : i,
      );
      const dropped = filled.filter((f) => leaking.has(f.module) || leaking.has(f.test));
      for (const f of dropped)
        for (const p of [f.module, f.test]) rmSync(join(repoDir, p), { force: true });
      filled = filled.filter((f) => !dropped.includes(f));
      await deps.emit(buildId, "integrating", "secret-scan", { removed: [...leaking] });
    }
    if (integrationError) {
      // Install failed: nothing half-integrated stays in the repository.
      git(repoDir, "reset", "-q", "--hard", assembledCommit);
      git(repoDir, "clean", "-qfd");
      integrations = [];
      filled = [];
    } else if (integrations.length > 0 || filled.length > 0) {
      appendComponentsDoc(repoDir, integrations, filled);
      git(repoDir, "add", "-A");
      git(
        repoDir,
        "commit",
        "-q",
        "-m",
        `feat: integrate ${integrations.length} component(s), backup coder fills ${filled.length} gap(s)`,
      );
    }
    await deps.emit(buildId, "integrating", "done", {
      integrated: integrations.map((i) => ({
        component: i.component,
        glue: i.glue,
        test: i.contractTest,
      })),
      backup: filled.map((f) => ({
        capability: f.capability,
        trigger: f.trigger,
        model: f.model,
        usage: f.usage,
        module: f.module,
      })),
      error: integrationError,
    });
  }
  // T3 files: secret scan before git, then one commit (each entity's rules are kept or dropped as a whole).
  const t3 = await rulesTask;
  let rules = t3.written;
  if (rules.length > 0) {
    for (const r of rules) for (const f of r.files) writeAt(repoDir, f.path, f.content);
    const leaking = new Set(
      leakingFiles(
        repoDir,
        rules.flatMap((r) => [r.module, r.test]),
      ),
    );
    const dropped = rules.filter((r) => leaking.has(r.module) || leaking.has(r.test));
    if (dropped.length > 0) {
      // The entity's rules module goes back to the assembled stub; its tests did not exist there.
      for (const r of dropped) {
        git(repoDir, "checkout", "-q", assembledCommit, "--", r.module);
        if (r.relatedModule) git(repoDir, "checkout", "-q", assembledCommit, "--", r.relatedModule);
        for (const f of [r.test, r.fixtures]) rmSync(join(repoDir, f), { force: true });
      }
      rules = rules.filter((r) => !dropped.includes(r));
      await deps.emit(buildId, "integrating", "secret-scan", { removed: [...leaking] });
    }
    git(repoDir, "add", "-A");
    if (rules.length > 0) {
      git(
        repoDir,
        "commit",
        "-q",
        "-m",
        `feat: business rules for ${rules.length} entit(ies) (T3)`,
      );
    }
    await deps.emit(buildId, "integrating", "rules", {
      rules: rules.map((r) => ({
        entity: r.entity,
        rules: r.rules,
        specs: r.specs,
        module: r.module,
        model: r.model,
      })),
    });
  }
  lap("integrate", t);
  const integratedCaps = new Set(integrations.map((i) => i.capability));
  const filledCaps = new Set(filled.map((f) => f.capability));
  const pendingIntegration = external.filter((e) => !integratedCaps.has(e.capability));
  const gapsWithPending = [
    ...gaps.filter((g) => !filledCaps.has(g.capability)),
    ...pendingIntegration.map((p) => ({
      capability: p.capability,
      trigger: `integration failed: ${p.component}`,
    })),
  ];
  const usedComponents = selected.filter(
    (s) => integrable(s.component) || integratedCaps.has(s.capability),
  );

  // 5 · verify → automatic security remediation → report (shared with "improve and redeliver")
  t = performance.now();
  const metrics: Record<string, unknown> = {
    tokens: { compiler: compiled.usage, decider: "input-only, counted by the provider" },
    ...(t5 ? { compilerBackup: { trigger: "T5", model: t5.model } } : {}),
    decider: selection.decider,
    reuse: {
      generatedLines: assembled.generatedLines,
      reusedLines: assembled.reusedLines,
      reusedShare: +(
        assembled.reusedLines / Math.max(1, assembled.reusedLines + assembled.generatedLines)
      ).toFixed(3),
    },
    recipe: { requested: spec.recipe, built: recipeId },
    brand: brand
      ? { color: brand.primaryColor ?? null, font: brand.font ?? null, logo: Boolean(brand.logo) }
      : null,
    components: [...new Set(usedComponents.map((s) => s.component.id))],
    integrated: integrations.map((i) => ({
      component: i.component,
      capability: i.capability,
      glue: i.glue,
      contractTest: i.contractTest,
      usage: i.usage,
    })),
    backup: {
      activations: [
        ...filled.map((f) => ({
          capability: f.capability,
          trigger: f.trigger,
          model: f.model,
          failedOver: f.failedOver,
          usage: f.usage,
          module: f.module,
        })),
        ...rules.map((r) => ruleActivation(r, true)),
      ],
    },
    businessRules: t3.candidates.map((c) => ({
      criterion: c.criterion,
      entity: c.entity,
      operations: c.operations,
      related: c.related,
      selected: c.selected,
      reason: c.reason,
    })),
    pendingIntegration,
    gaps: gapsWithPending,
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
        components: usedComponents.map((s) => ({ capability: s.capability, id: s.component.id })),
        gaps: gapsWithPending.map((g) => g.capability),
        gapLabels: CAPABILITY_LABELS,
        backupGenerated: filled.map((f) => ({
          capability: f.capability,
          label: label(f.capability),
          file: f.module,
        })),
        reusedShare: (metrics.reuse as { reusedShare: number }).reusedShare,
        businessRules: rules.map((r) => ({
          capability: rulesCapability(slugOf(r.module)),
          entity: r.entity,
          rules: r.rules,
          specs: r.specs,
          file: r.module,
          test: r.test,
        })),
      },
      metrics: { ...metrics, timings },
      swap: {
        toCommit: assembledCommit,
        capabilities: [
          ...integratedCaps,
          ...filledCaps,
          ...rules.map((r) => rulesCapability(slugOf(r.module))),
        ],
        parts: [
          ...integrations.flatMap((i) =>
            i.glue ? [{ capability: i.capability, kind: "glue" as const, files: [i.glue] }] : [],
          ),
          ...filled.map((f) => ({
            capability: f.capability,
            kind: "backup" as const,
            files: [f.module, f.test],
          })),
          ...rules.map((r) => ({
            capability: rulesCapability(slugOf(r.module)),
            kind: "rules" as const,
            files: [r.module, r.test, r.fixtures, ...(r.relatedModule ? [r.relatedModule] : [])],
          })),
        ],
      },
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
    handover: fin.handover,
    improvement: fin.improvement,
    corrections: fin.corrections,
    swappedOut: fin.swappedOut,
    glueRemoved: fin.glueRemoved,
    // What is in the delivered repository after corrections and swaps.
    components: usedComponents
      .filter((u) => !fin.swappedOut.includes(u.capability))
      .map((u) => u.component.id)
      .filter((id, i, all) => all.indexOf(id) === i),
    integrated: integrations
      .filter((i) => !fin.swappedOut.includes(i.capability))
      .map((i) => ({ ...i, glue: fin.glueRemoved.includes(i.capability) ? null : i.glue })),
    backup: {
      activations: [
        ...filled.map((f) => ({
          capability: f.capability,
          trigger: f.trigger,
          model: f.model,
          failedOver: f.failedOver,
          usage: f.usage,
          module: f.module,
          kept: !fin.swappedOut.includes(f.capability),
        })),
        ...rules.map((r) =>
          ruleActivation(r, !fin.swappedOut.includes(rulesCapability(slugOf(r.module)))),
        ),
      ],
    },
    gaps: [
      ...gapsWithPending,
      ...fin.swappedOut
        .filter((capability) => !capability.startsWith("rules."))
        .map((capability) => ({
          capability,
          trigger: "removed after failed corrections (T4)",
        })),
    ],
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
    correction: { compiler: deps.compiler, backupCoder: deps.backupCoder },
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
    handover: fin.handover,
    improvement: fin.improvement,
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

/** COMPONENTS.md after integration: integrated libraries and Backup Coder helpers, removed from "not covered". */
function appendComponentsDoc(
  repoDir: string,
  integrations: IntegrationResult[],
  filled: FilledGap[],
): void {
  const path = join(repoDir, "COMPONENTS.md");
  if (!existsSync(path)) return;
  const done = new Set([
    ...integrations.map((i) => i.capability),
    ...filled.map((f) => f.capability),
  ]);
  const kept = readFileSync(path, "utf8")
    .split("\n")
    .filter(
      (line) =>
        !/^- `([^`]+)` \(trigger /.test(line) || !done.has(/^- `([^`]+)`/.exec(line)?.[1] ?? ""),
    )
    .join("\n");
  // Drop the "not covered" heading when nothing is left under it.
  const body = kept.replace(/## Not covered by a catalog component\s*$/, "");
  const sections = [
    integrations.length
      ? `## Integrated after assembly\n\nInstalled at the exact approved version; the component's contract test runs in this app (\`tests/unit/components/\`).\n\n${integrations
          .map(
            (i) =>
              `- \`${i.capability}\` → \`${i.component}\`${i.glue ? ` · helper \`${i.glue}\`` : ""}`,
          )
          .join("\n")}\n`
      : "",
    filled.length
      ? `## Written by the Backup Coder\n\nNo audited component exists yet for these capabilities. The code carries \`// turbineh:generated-backup\`, has its own unit tests and passed the same verification.\n\n${filled
          .map(
            (f) => `- \`${f.capability}\` (${f.trigger}) → \`${f.module}\` · tests \`${f.test}\``,
          )
          .join("\n")}\n`
      : "",
  ].filter(Boolean);
  writeFileSync(path, `${body.trimEnd()}\n\n${sections.join("\n")}`);
}

const slugOf = (rulesModule: string) => rulesModule.split("/")[2] ?? rulesModule;

function ruleActivation(r: WrittenRules, kept: boolean) {
  return {
    capability: rulesCapability(slugOf(r.module)),
    trigger: "T3" as const,
    model: r.model,
    failedOver: r.failedOver,
    usage: r.usage,
    module: r.module,
    rules: r.rules,
    specs: r.specs,
    kept,
  };
}

function writeAt(dir: string, rel: string, content: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

/**
 * T3: which acceptance criteria are business rules on entities this build generated (decider + fixed thresholds),
 * then one Backup Coder module + test per entity. Rules on recipe-provided entities stay the recipe's job.
 */
async function businessRules(
  repoDir: string,
  spec: Parameters<typeof entitiesToGenerate>[0],
  recipe: { description: string; providedEntities: string[] },
  deps: PipelineDeps,
  buildId: string,
): Promise<{ candidates: RuleCandidate[]; written: WrittenRules[] }> {
  const entities = entitiesToGenerate(spec, [
    ...recipe.providedEntities,
    ...providedTables(repoDir),
  ]);
  if (entities.length === 0) return { candidates: [], written: [] };
  const lib = readFileSync(join(repoDir, "src/lib/rules.ts"), "utf8");
  const read = (rel: string) => readFileSync(join(repoDir, rel), "utf8");
  // Which generated entities each one references (reference fields): the only cross-entity reads T3 implements.
  const links = Object.fromEntries(entities.map((e) => [e.name, referencedEntities(e, entities)]));
  const candidates = await decideRules(
    {
      summary: spec.summary,
      recipe:
        `${recipe.description}. Every other entity gets create and edit forms that already reject missing ` +
        "required values and values of the wrong type (emails, numbers, dates), a searchable list and delete, " +
        "scoped to the workspace.",
      criteria: spec.acceptance_criteria,
      entities: Object.fromEntries(
        entities.map((e) => [e.name, fieldsOf(e).map((f) => `${f.name} (${f.type})`)]),
      ),
      links,
    },
    deps.decider,
  );
  await deps.emit(buildId, "integrating", "rules-decided", {
    candidates: candidates.map((c) => ({
      criterion: c.criterion,
      entity: c.entity,
      operations: c.operations,
      related: c.related,
      reason: c.reason,
    })),
  });
  const targets: RuleTarget[] = [];
  for (const e of entities) {
    const chosen = candidates.filter((c) => c.selected && c.entity === e.name);
    if (chosen.length === 0) continue;
    const relatedNames = [...new Set(chosen.flatMap((c) => c.related))];
    const f = ruleFiles(e, entities, relatedNames);
    targets.push({
      entity: e.name,
      pascal: f.pascal,
      slug: f.slug,
      rules: chosen.map((c) => c.criterion),
      specs: chosen.map((c) => ({
        rule: c.criterion,
        operations: c.operations,
        related: c.related.filter((r) => f.relatedEntities.some((x) => x.entity === r)),
      })),
      files: {
        rules: f.rules,
        schema: f.schema,
        table: f.table,
        related: f.related,
        test: f.test,
        fixtures: f.fixtures,
      },
      samples: f.samples,
      formats: f.formats,
      fixturesTest: f.fixturesTest,
      relatedModule: f.relatedModule,
      related: f.relatedEntities.map((r) => ({
        entity: r.entity,
        pascal: r.pascal,
        slug: r.slug,
        key: r.key,
        referencedBy: r.referencedBy,
        displayField: r.displayField,
        sample: r.sample,
        schema: read(r.schema),
      })),
      contracts: { schema: read(f.schema), table: read(f.table), lib },
    });
  }
  const written = await Promise.all(
    targets.map((t) =>
      writeRules(t, deps.backupCoder, {
        buildId,
        summary: spec.summary,
        gapsDir: deps.gapsDir ?? join(deps.repoRoot, "catalog/gaps"),
      }).catch(() => null),
    ),
  );
  return { candidates, written: written.filter((w): w is WrittenRules => w !== null) };
}
