import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  acceptanceStatus,
  assemble,
  coverageRules,
  entitiesToGenerate,
  entityNames,
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
import {
  compileIntent,
  detectDomains,
  extractPalette,
  separateNonFunctional,
  type BuildSpec,
  type CompileResult,
  type CompilerConfig,
} from "@turbineh/compiler";
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
  backupMayFill,
  fillGap,
  glueCacheKey,
  integrateComponents,
  rulesCapability,
  writeRules,
  type FilledGap,
  type IntegrationResult,
  type RuleTarget,
  type WrittenRules,
} from "@turbineh/integrator";
import { leakingFiles, type VerifyResult } from "@turbineh/verifier";
import { decideRules, rulesWithoutCode, type RuleCandidate } from "./business-rules.js";
import { finalize, type FinalizeDeps } from "./finalize.js";
import { deliveryReason, type Delivery } from "./not-verified.js";
import { candidatesFor, externalComponent, loadCatalog } from "./catalog-source.js";
import { notCoveredReason, openCriteriaLeft, type ScopeVerdict } from "@turbineh/engine";
import { coveredPart, gateRequest, withScope } from "./scope.js";
import type { Plan } from "@turbineh/shared";
import { componentPlan, flowPlan, type PlanRequest } from "./product.js";
import { mergeDomains, wireFidelity } from "./fidelity-wiring.js";
import { requireRequirements } from "./required-components.js";

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
  /** Glue modules that passed the full gate, reused by later builds (ADR-0036). */
  glueCache?: {
    get: (key: string) => Promise<{ content: string } | null>;
    put: (key: string, content: string) => Promise<void>;
  };
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
  /**
   * What the build delivers (ADR-0037 §D1). `unverified`: status stays "failed" (never verified, never deployable)
   * but the package is stored and handed over with the exact failure; `report_only`: only the report.
   */
  delivery?: Delivery;
}

/**
 * Test-only (ADR-0037): adds one E2E test that always fails, to prove the "delivered, not verified" path end to end.
 * Honoured only when the worker runs with TURBINEH_TEST_FLAGS=1, which is never set in production (deploy.sh refuses a
 * production worker whose environment file sets it).
 */
export const FORCED_FAILURE_SPEC = "tests/e2e/turbineh-forced-failure.spec.ts";
export const FORCED_FAILURE_MARKER = "[turbineh-test:force-e2e-failure]";
export function forcedFailureRequested(
  prompt: string,
  env: Record<string, string | undefined>,
): boolean {
  return env.TURBINEH_TEST_FLAGS === "1" && prompt.includes(FORCED_FAILURE_MARKER);
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

/**
 * Which of the request's criteria a test shipped with the recipe chain or a selected component will prove (the same
 * acceptance.yaml rules the assembler applies), known before anything is generated (ADR-0036). Criteria proved later by
 * generated entity tests show as open here and as met in the delivered package's turbineh.json.
 */
export function planCriteria(
  criteria: readonly string[],
  recipesDir: string,
  recipe: string,
  componentIds: string[],
): NonNullable<Plan["criteria"]> {
  const rules = coverageRules({
    recipesDir,
    recipe,
    selected: componentIds.map((id) => ({ component: { id } })) as SelectedComponent[],
  });
  return acceptanceStatus(criteria, rules, false).map((c) => ({
    criterion: c.criterion,
    status: c.status === "open" ? "open" : "covered",
    tests: c.tests,
  }));
}

export async function runBuild(
  prompt: string,
  deps: PipelineDeps,
  buildId: string = randomUUID(),
  options: {
    brand?: unknown;
    /** Generate from an approved plan: the stored spec is used as is (no recompilation, same selection via cache). */
    spec?: BuildSpec;
    /** Plan only (PLAN §16.4): stop after selection and resolution and return the plan. */
    plan?: PlanRequest;
    /** Test-only (see FORCED_FAILURE_SPEC): one E2E test that always fails. */
    forceFailure?: boolean;
    /**
     * Direct builds (no plan): the person chose to build only the covered part of a partially covered request
     * (ADR-0052). Plans ask for that choice through `needsApproval` instead.
     */
    coveredOnly?: boolean;
  } = {},
): Promise<BuildOutcome> {
  // The test-only marker never reaches a model (it is honoured only through options.forceFailure).
  prompt = prompt.split(FORCED_FAILURE_MARKER).join(" ").trim();
  // Client brand: validated again here (colour format, font list, logo type by magic bytes, size).
  const brand = parseBrand(options.brand);
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));

  // 1 · compile (decider batch + small parts)
  let t = performance.now();
  await deps.emit(buildId, "compiling", "start", { prompt });
  let compiled: CompileResult = options.spec
    ? {
        ok: true,
        spec: structuredClone(options.spec),
        attempts: {} as CompileResult["attempts"],
        latencyMs: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        errors: [],
        escalate: false,
      }
    : await compileIntent(prompt, deps.compiler, deps.decider);
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
  // Non-functional requirements are capabilities, never entities (ADR-0037 §D3): also for specs stored before the rule.
  const separated = separateNonFunctional(compiled.spec);
  const spec = separated.spec;
  const nonFunctional = [...(compiled.nonFunctional ?? []), ...separated.requirements];
  if (nonFunctional.length > 0) {
    await deps.emit(buildId, "compiling", "non-functional", {
      requirements: nonFunctional.map((r) => ({
        kind: r.kind,
        source: r.source,
        capabilities: r.capabilities,
      })),
    });
  }
  // Specs stored before palettes existed (approved plans) still get the colours stated in the prompt.
  if (spec.palette === undefined) spec.palette = extractPalette(prompt);
  const catalogDir = join(deps.repoRoot, "catalog/components");
  // Scope gate (ADR-0052, supersedes ADR-0050 §4): only covered use cases, or the components the person chose, are
  // operated. Generation from an approved plan was gated when it was planned.
  const explicit = options.plan?.components ?? [];
  const componentOnly =
    explicit.length > 0 ||
    (spec.recipe === "out_of_scope" &&
      options.plan !== undefined &&
      options.plan.stack.source !== "declared");
  let verdict: ScopeVerdict | null = null;
  if (!options.spec) {
    const candidate =
      componentOnly && options.plan
        ? componentPlan(buildId, options.plan, catalogDir, explicit)
        : null;
    t = performance.now();
    verdict = await gateRequest({
      prompt,
      spec,
      componentsDir: catalogDir,
      decider: deps.decider,
      explicit,
      ...(candidate
        ? { componentIds: candidate.components.map((c) => c.id) }
        : {
            provenByTests: new Set(
              spec.recipe === "out_of_scope"
                ? []
                : planCriteria(
                    spec.acceptance_criteria,
                    join(deps.repoRoot, "catalog/recipes"),
                    spec.recipe,
                    [],
                  )
                    .filter((c) => c.status === "covered")
                    .map((c) => c.criterion),
            ),
          }),
    });
    lap("scope", t);
    await deps.emit(buildId, "compiling", "scope_gate", {
      status: verdict.status,
      via: verdict.via,
      useCase: verdict.useCase,
      notCovered: verdict.notCovered,
    });
    const refused =
      verdict.status === "uncovered" ||
      (verdict.status === "partial" && !options.plan && !options.coveredOnly);
    if (refused) {
      // Nothing is generated: the person is told the library doesn't cover it yet; the demand is recorded.
      return {
        buildId,
        status: "failed",
        spec,
        reason: notCoveredReason(verdict),
        metrics: { timings, scopeGate: verdict, tokens: { compiler: compiled.usage } },
      };
    }
    if (candidate) {
      const plan = withScope(candidate, verdict, spec.app_name);
      await deps.emit(buildId, "selecting", "done", {
        componentOnly: true,
        selected: plan.components.map((c) => c.id),
      });
      return {
        buildId,
        status: "done",
        spec: verdict.status === "partial" ? coveredPart(spec, verdict) : spec,
        metrics: { timings, plan, scopeGate: verdict, tokens: { compiler: compiled.usage } },
      };
    }
  }
  const requestedName = spec.app_name;
  if (verdict?.status === "partial") Object.assign(spec, coveredPart(spec, verdict));
  // Every requirement is covered here: a request no family matched but whose requirements all map to the catalogue is
  // built on the closest template (recorded; ADR-0052 keeps this only for fully covered requests).
  let scope: { builtOn: string; reason: string } | null = null;
  if (spec.recipe === "out_of_scope") {
    scope = {
      builtOn: spec.closest_recipe ?? "saas-crud",
      reason: spec.out_of_scope_reason ?? "No ready-made template matches this need exactly.",
    };
    spec.recipe = scope.builtOn as BuildSpec["recipe"];
    spec.closest_recipe = null;
    spec.out_of_scope_reason = null;
    await deps.emit(buildId, "compiling", "scope", scope);
  }
  const recipesDir = join(deps.repoRoot, "catalog/recipes");
  // Families without their own recipe yet fall back to the multi-tenant CRUD base (recorded in metrics).
  const recipeId = hasRecipe(recipesDir, spec.recipe) ? spec.recipe : "saas-crud";
  const recipe = mergedRecipe(recipeChain(recipesDir, recipeId));
  // Recipe defaults are added by code, never left to the model.
  spec.capabilities = [
    ...new Set([...spec.capabilities, ...recipe.defaultCapabilities]),
  ] as typeof spec.capabilities;
  // Spec fidelity (ADR-0042/0043): entity kinds, roles and rules, constraints and domain patterns, by code (the decider
  // only for entity kinds the rules are unsure of); each pattern's catalog component is selected by code with params
  // validated against its params.schema.json.
  const fidelity = await wireFidelity(prompt, spec, {
    recipeId,
    recipeChain: recipeChain(recipesDir, recipeId).map((m) => m.id),
    componentsDir: join(deps.repoRoot, "catalog/components"),
    knownEntities: recipe.providedEntities,
    decider: deps.decider,
  }).catch(() => null);
  if (fidelity) {
    spec.entities = fidelity.spec.entities;
    spec.capabilities = fidelity.spec.capabilities;
    await deps.emit(buildId, "compiling", "fidelity", {
      entities: fidelity.fidelity.entities.map((e) => ({ name: e.name, kind: e.kind, ui: e.ui })),
      roles: fidelity.fidelity.permissions.roles.map((r) => ({ id: r.id, label: r.label })),
      patterns: fidelity.wired.patterns.map((p) => ({
        id: p.id,
        status: p.status,
        component: p.component,
        reason: p.reason,
      })),
      decider: fidelity.fidelity.decider,
    });
  }
  // Domain components (ADR-0033): detected and parameterised from the request by code, selected by code.
  const domains = mergeDomains(
    fidelity?.wired.selected ?? [],
    detectDomains(prompt, recipeId, spec.app_name),
  );
  if (domains.length > 0) {
    recipe.requiredComponents = {
      ...(recipe.requiredComponents ?? {}),
      ...Object.fromEntries(domains.map((d) => [d.capability, d.component])),
    };
    await deps.emit(buildId, "compiling", "domains", {
      domains: domains.map((d) => ({
        id: d.id,
        component: d.component,
        assumptions: d.assumptions,
      })),
    });
  }

  // 2 · select (one batched decider request for the whole build)
  t = performance.now();
  const catalog = loadCatalog(join(deps.repoRoot, "catalog/components"));
  // Components a required component needs (e.g. ui.kanban → domain.workflow, ADR-0048) are required too: with the
  // request's params when the fidelity output has them, otherwise with their defaults, listed under "What is left".
  const requirements = requireRequirements({
    required: (recipe.requiredComponents ??= {}),
    catalog,
    componentsDir: join(deps.repoRoot, "catalog/components"),
    recipe: recipeId,
    patterns: fidelity?.wired.patterns ?? [],
    parameterised: new Set(domains.map((d) => d.component)),
  });
  domains.push(...requirements.domains);
  if (fidelity) fidelity.assembly.patterns.push(...requirements.defaults);
  const selectionInput = {
    app: {
      recipe: spec.recipe,
      summary: spec.summary,
      acceptance_criteria: spec.acceptance_criteria,
    },
    candidates: candidatesFor(
      spec.capabilities.filter(
        (c) =>
          !recipe.providedCapabilities?.includes(c) && !(c in (recipe.requiredComponents ?? {})),
      ),
      catalog,
    ),
  };
  const cacheKey = selectionCacheKey(selectionInput, deps.decider.selectionVersion);
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
  // The effective package.json: the last template in the chain that ships one (overlays win, e.g. ai-agents adds the
  // decider SDK to the base dependencies).
  const baseTemplate =
    recipeChain(recipesDir, recipeId)
      .map((m) => join(recipesDir, m.id, "template"))
      .reverse()
      .find((dir) => existsSync(join(dir, "package.json"))) ??
    join(recipesDir, recipeId, "template");
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
  // Components the recipe's code depends on (e.g. AI orchestrator + AI Safety Pack, ADR-0028) are selected by code.
  const required = Object.fromEntries(
    Object.entries(recipe.requiredComponents ?? {}).map(([capability, id]) => {
      const c = catalog.find(
        (x) => x.id === id && x.status === "approved" && x.provides.includes(capability),
      );
      if (!c)
        throw new Error(`recipe ${recipeId} requires ${id}, which is not an approved component`);
      return [capability, c];
    }),
  );
  const resolution = resolveSet(ranked, stack, required);
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
  if (options.plan) {
    const envTemplate = recipeChain(recipesDir, recipeId)
      .map((m) => join(recipesDir, m.id, "template", ".env.example"))
      .reverse()
      .find((f) => existsSync(f));
    const plan = flowPlan({
      buildId,
      request: options.plan,
      slug: spec.slug,
      recipeId,
      selected: resolution.selected,
      decisions: selection.decisions,
      gaps: gaps.map((g) => g.capability),
      templateDeps: pkg.dependencies,
      templateEnv: envTemplate ? readFileSync(envTemplate, "utf8") : "",
      componentsDir: join(deps.repoRoot, "catalog/components"),
      entities: spec.entities.map((e) => e.name),
      labels: (cap) => CAPABILITY_LABELS[cap] ?? cap,
      ...(scope ? { scope } : {}),
    });
    plan.criteria = planCriteria(spec.acceptance_criteria, recipesDir, recipeId, [
      ...Object.values(resolution.selected).map((c) => c.id),
    ]);
    plan.left = [...(plan.left ?? []), ...openCriteriaLeft(plan.criteria)];
    if (verdict) withScope(plan, verdict, requestedName);
    return {
      buildId,
      status: "done",
      spec,
      metrics: {
        timings,
        plan,
        tokens: { compiler: compiled.usage },
        decider: selection.decider,
        ...(verdict ? { scopeGate: verdict } : {}),
      },
    };
  }

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
  // Live progress (ADR-0051): what is being assembled, before the work starts.
  await deps.emit(buildId, "assembling", "start", {
    components: selected.filter((x) => integrable(x.component)).map((x) => x.component.id),
    later: external.map((e) => e.component),
    recipe: recipeId,
  });
  const assembled = assemble({
    buildId,
    recipesDir,
    recipe: recipeId,
    outDir: repoDir,
    spec,
    // Docs list only what is in the repository now; the integration step updates COMPONENTS.md when it succeeds.
    selected: selected.filter((x) => integrable(x.component)),
    brand,
    domains,
    ...(fidelity ? { fidelity: fidelity.assembly } : {}),
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
  if (options.forceFailure) {
    writeAt(
      repoDir,
      FORCED_FAILURE_SPEC,
      `import { expect, test } from "@playwright/test";

// Test-only (TURBINEH_TEST_FLAGS): proves that a failing gate still delivers the package, marked not verified.
test("forced failure for the not-verified delivery test", () => {
  expect(1, "forced by the TurbineH test flag").toBe(2);
});
`,
    );
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-q", "-m", "test: forced failure (test-only flag)");
  }
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
  // ADR-0055 (audit F09): a capability an approved component provides is never written by the Backup Coder, even
  // when the resolver could not use that component in this build — it is reported as not covered instead.
  const catalogued = new Set(
    catalog.filter((c) => c.status === "approved").flatMap((c) => c.provides),
  );
  const toFill = gaps
    .filter(
      (g) => backupMayFill(g.capability, catalogued) && (g.trigger === "T1" || g.trigger === "T2"),
    )
    .map((g) => ({
      capability: g.capability,
      label: label(g.capability),
      trigger: g.trigger as "T1" | "T2",
    }));
  const externals = external.map((e) =>
    externalComponent(componentsDir, e.component, e.capability, label(e.capability)),
  );
  let integrations: IntegrationResult[] = [];
  let filled: FilledGap[] = [];
  let integrationError: string | null = null;
  if (external.length > 0 || toFill.length > 0) {
    await deps.emit(buildId, "integrating", "start", {
      components: external.map((e) => e.component),
      gaps: toFill.map((g) => g.capability),
    });
    const [ints, fills] = await Promise.all([
      integrateComponents(repoDir, externals, deps.compiler, deps.glueCache).catch(
        (err: unknown) => {
          integrationError =
            err instanceof Error ? err.message.slice(0, 300) : "integration failed";
          return [] as IntegrationResult[];
        },
      ),
      Promise.all(
        toFill.map((g, i) =>
          fillGap(repoDir, g, deps.backupCoder, {
            buildId,
            summary: spec.summary,
            allowedImports: ["zod", ...Object.keys(pkg.dependencies)],
            gapsDir: deps.gapsDir ?? join(deps.repoRoot, "catalog/gaps"),
            catalogued,
          })
            .catch(() => null)
            .then(async (r) => {
              await deps
                .emit(buildId, "integrating", "progress", {
                  gap: g.capability,
                  ok: r !== null,
                  index: i + 1,
                  total: toFill.length,
                })
                .catch(() => undefined);
              return r;
            }),
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
    ...(verdict ? { scopeGate: verdict } : {}),
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
    nonFunctional,
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
        // Rules of the request without code: listed as limitations or blocked items, never dropped (ADR-0054).
        rulesNotImplemented: rulesWithoutCode(
          t3.candidates,
          rules.flatMap((r) => r.rules),
        ),
      },
      metrics: { ...metrics, timings },
      swap: {
        toCommit: assembledCommit,
        parts: [
          ...integrations.flatMap((i) =>
            i.glue ? [{ capability: i.capability, kind: "glue" as const, files: [i.glue] }] : [],
          ),
          // Integrated libraries (ADR-0037 §D2): implicated only when a failing file imports them or their contract
          // test fails; removing one drops its contract test and glue (the pinned dependency stays unused).
          ...integrations.map((i) => ({
            capability: i.capability,
            kind: "integration" as const,
            files: i.contractTest ? [i.contractTest] : [],
            package: resolution.selected[i.capability]?.pkg.name ?? i.component,
          })),
          ...filled.map((f) => ({
            capability: f.capability,
            kind: "backup" as const,
            files: [f.module, f.test],
          })),
          ...rules.map((r) => ({
            capability: rulesCapability(slugOf(r.module)),
            kind: "rules" as const,
            files: [r.module, r.test, r.fixtures, ...(r.relatedModule ? [r.relatedModule] : [])],
            entity: r.entity,
          })),
        ],
      },
    },
    finalizeDeps(deps, buildId),
  );
  lap("verify", t);
  // Model-written glue that is still in the app after a green gate is now known-good: later builds reuse it.
  if (fin.ok && deps.glueCache) {
    for (const i of integrations) {
      const c = externals.find((e) => e.id === i.component && e.capability === i.capability);
      if (!c || !i.glue || i.reused) continue;
      if (fin.swappedOut.includes(i.capability) || fin.glueRemoved.includes(i.capability)) continue;
      const file = join(repoDir, i.glue);
      const content = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (!content.includes("source=catalog"))
        await deps.glueCache.put(glueCacheKey(c), content).catch(() => undefined);
    }
  }
  const finalMetrics = {
    ...metrics,
    timings: { ...timings, total: Math.round(performance.now() - t0) },
    alerts: fin.alerts,
    remediation: fin.remediation,
    // ADR-0065: first pass, corrections with diffs, refused changes and the findings a re-scan confirmed fixed.
    audit: fin.audit,
    exceptions: fin.exceptions,
    report: fin.report,
    handover: fin.handover,
    improvement: fin.improvement,
    corrections: fin.corrections,
    swappedOut: fin.swappedOut,
    glueRemoved: fin.glueRemoved,
    // Failure → owner → implicated parts, per swap round (ADR-0037 §D2).
    attribution: fin.attribution,
    acceptance: fin.acceptance,
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
          trigger: "removed: a failing check was attributed to it (T4)",
        })),
    ],
  };
  await deps.emit(buildId, fin.ok ? "done" : "failed", "done", {
    repoDir,
    alerts: fin.alerts.length,
    remediated: fin.audit.fixed.length,
    delivery: fin.delivery.kind,
  });
  return {
    buildId,
    status: fin.ok ? "done" : "failed",
    repoDir,
    metrics: { ...finalMetrics, delivery: fin.delivery },
    verify: fin.verify,
    spec,
    delivery: fin.delivery,
    ...(fin.ok ? {} : { reason: deliveryReason(fin.delivery) }),
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
    // ADR-0065: first pass, corrections with diffs, refused changes and the findings a re-scan confirmed fixed.
    audit: fin.audit,
    exceptions: fin.exceptions,
    report: fin.report,
    handover: fin.handover,
    improvement: fin.improvement,
    improved: true,
    improvedFrom: parent.metrics.buildId ?? null,
  };
  await deps.emit(buildId, fin.ok ? "done" : "failed", "done", {
    repoDir,
    alerts: fin.alerts.length,
    remediated: fin.audit.fixed.length,
    delivery: fin.delivery.kind,
  });
  return {
    buildId,
    status: fin.ok ? "done" : "failed",
    repoDir,
    metrics: { ...metrics, delivery: fin.delivery },
    verify: fin.verify,
    spec: parent.spec,
    delivery: fin.delivery,
    ...(fin.ok ? {} : { reason: deliveryReason(fin.delivery) }),
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
      ? `## Written by TurbineH — NOT catalogue-verified\n\nNo approved catalogue component provides these capabilities, so a model wrote them. They are **not catalogue-verified**: no contract tests, security review or audit beyond this build's own gate. The code carries \`// turbineh:generated-backup\` and its own unit tests; review it before relying on it.\n\n${filled
          .map((f) => `- \`${f.capability}\` → \`${f.module}\` · tests \`${f.test}\``)
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
  // Only entities generated with CRUD and a rules module (business and settings; not events, child lists or logs).
  const entities = entitiesToGenerate(spec, [
    ...recipe.providedEntities,
    ...providedTables(repoDir),
  ]).filter((e) => existsSync(join(repoDir, "src/entities", entityNames(e.name).slug, "rules.ts")));
  if (entities.length === 0) return { candidates: [], written: [] };
  const lib = readFileSync(join(repoDir, "src/lib/rules.ts"), "utf8");
  const read = (rel: string) => readFileSync(join(repoDir, rel), "utf8");
  // Which generated entities each one references (reference fields): the only cross-entity reads T3 implements.
  const links = Object.fromEntries(entities.map((e) => [e.name, referencedEntities(e, entities)]));
  const candidates = await decideRules(
    {
      summary: spec.summary,
      recipe: recipe.description,
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
