import type {
  CapabilitySummary,
  Decision,
  DetectedStack,
  FileChange,
  Plan,
  ProjectPreferences,
  Requirement,
} from "@turbineh/shared";
import { componentSummary, requirementsFor, summarizeUseCase } from "./search.js";
import { repositoryFit, type RepoAnalysis } from "./repo-analysis.js";
import { leftItems, planOutcome, standaloneFiles } from "./outcome.js";
import { compatibility, dependencyDiff } from "./stack.js";
import type { CatalogEntry, UseCase } from "./types.js";

/**
 * Measured averages (bench/results/2026-10-12-18-47-benchmark.md: 32 prompts on staging) used for plan estimates.
 * Component-only packages reuse certified code and call no model.
 */
export const MEASURED = {
  flowSeconds: 162,
  flowTokens: 10_039,
  flowModelCostUsd: 0.004,
  componentSeconds: 5,
} as const;

export interface PlannedComponent {
  id: string;
  version: string;
  license: string;
  purl: string;
  capability: string;
  why: string;
}

export interface PlanInput {
  id: string;
  need: string;
  slug: string;
  stack: DetectedStack;
  /** null → a component-only plan (no complete use case fits, e.g. AI inference for an existing product). */
  useCase: UseCase | null;
  components: PlannedComponent[];
  /** Capabilities without a verified component (would be written by the Backup Coder and verified). */
  gaps: string[];
  decisions: Decision[];
  dependencies: { name: string; version: string }[];
  /** The project's own dependencies (from its package.json), when known: only new ones are planned. */
  projectDependencies?: Record<string, string>;
  /** Parts of the need the plan does not cover (stated to the user, never hidden). */
  notCovered?: string[];
  /** Plain-language names of capabilities (gaps are shown with them). */
  labels?: (capability: string) => string;
  envKeys?: string[];
  entities?: string[];
  preferences?: ProjectPreferences;
  /** Analysis of the connected repository (PLAN §16 P5): conventions, conflicts and adaptation decisions. */
  analysis?: RepoAnalysis;
}

const native = (purl: string) => purl.startsWith("pkg:generic/turbineh");

const GAP_NOTICE = "No verified component covers ";
const gapNotice = (g: string) =>
  `${GAP_NOTICE}${g}: TurbineH writes it and verifies it with the rest.`;

/**
 * A decision that only says TurbineH will write (and verify with the same gate) a part no verified component covers.
 * `turbineh build` (ADR-0036) treats these as accepted by asking for the build; incompatibilities, policy limits and
 * adaptation conflicts still need a person.
 */
export const isGapNotice = (decision: string) => decision.startsWith(GAP_NOTICE);

/** What `apply` will change in the project: the package folder plus dependencies and example configuration. */
export function plannedFiles(
  slug: string,
  deps: number,
  env: number,
  base = `turbineh/${slug}`,
): FileChange[] {
  const files: FileChange[] = [
    {
      path: `${base}/README.md`,
      action: "add",
      why: "Start here: what the capability does and how to try it",
    },
    {
      path: `${base}/manifest.json`,
      action: "add",
      why: "Version, compatible stack, dependencies, components and licences",
    },
    {
      path: `${base}/src/`,
      action: "add",
      why: "Capability code with clear entry points (editable)",
    },
    {
      path: `${base}/tests/`,
      action: "add",
      why: "Checks that run in your project (turbineh verify)",
    },
    { path: `${base}/examples/`, action: "add", why: "Runnable example with sample data" },
    {
      path: `${base}/docs/`,
      action: "add",
      why: "Integration steps, architecture decisions, verification results",
    },
    {
      path: `${base}/agent/INTEGRATE.md`,
      action: "add",
      why: "Instructions for Claude Code or Codex to wire it in and continue",
    },
  ];
  if (deps > 0)
    files.push({
      path: "package.json",
      action: "modify",
      why: `Adds ${deps} verified dependenc${deps === 1 ? "y" : "ies"}`,
    });
  if (env > 0)
    files.push({
      path: ".env.example",
      action: "modify",
      why: `Documents ${env} setting${env === 1 ? "" : "s"} (names only, no secrets)`,
    });
  return files;
}

export function buildPlan(input: PlanInput): Plan {
  const kind = input.useCase ? "use_case" : "component";
  const base = compatibility(input.stack, kind);
  const deps = dependencyDiff(input.dependencies, input.projectDependencies);
  // The repository analysis states version conflicts in its own words: list each package once.
  const repoConflicts = input.analysis ? [] : deps.conflicts;
  const compat = {
    ...base,
    // Version conflicts are listed and need approval, but the stack can still host the package.
    compatible: base.compatible,
    incompatibilities: [...base.incompatibilities, ...repoConflicts],
  };
  const caps = input.components.map((c) => c.capability);
  // One component can cover several capabilities: list it once with all of them.
  const components = new Map<string, PlannedComponent>();
  for (const c of input.components) {
    const seen = components.get(c.id);
    if (!seen) components.set(c.id, { ...c });
    else if (!seen.why.includes(c.why))
      seen.why = `${seen.why}; ${c.why.charAt(0).toLowerCase()}${c.why.slice(1)}`;
  }
  const capability: CapabilitySummary = input.useCase
    ? summarizeUseCase(input.useCase, components.size)
    : {
        ...componentSummary({
          id: input.slug,
          version: "1.0.0",
          category: "capability",
          provides: caps,
          license: "MIT",
          purl: "pkg:generic/turbineh",
          does: input.need,
        }),
        name: input.slug,
        components: components.size,
      };
  const config: Requirement[] = [
    ...(input.useCase
      ? requirementsFor([...input.useCase.capabilities, ...caps])
      : requirementsFor(caps)),
    ...(input.envKeys ?? [])
      .filter((k) => !["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"].includes(k))
      .map((k) => ({
        kind: "env" as const,
        name: k,
        why: "Setting documented in config/.env.example",
        satisfied: false,
      })),
  ].filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i);
  const envCount = config.filter((r) => r.kind === "env").length;
  const policy = input.preferences?.changePolicy;
  const needsApproval = [
    ...compat.incompatibilities.map((i) => `Before you continue: ${i}`),
    ...input.gaps.map(gapNotice),
    ...(policy && !policy.allowDependencyChanges && deps.added.length > 0
      ? [
          `Adds ${deps.added.length} dependencies, but this project's policy does not allow new dependencies.`,
        ]
      : []),
    ...(policy && !policy.allowNewEnv && envCount > 0
      ? [
          `Needs ${envCount} new settings, but this project's policy does not allow new environment variables.`,
        ]
      : []),
  ];
  const external = [...components.values()].filter((c) => !native(c.purl)).length;
  const repository = input.analysis
    ? repositoryFit(input.analysis, {
        kind,
        slug: input.slug,
        usesDatabase:
          kind === "use_case" ||
          [...components.keys()].some((id) =>
            /orchestrator|ai-safety|jobs|payments|storage|vector/.test(id),
          ),
        usesAuth: kind === "use_case",
        dependencies: Object.fromEntries(input.dependencies.map((d) => [d.name, d.version])),
      })
    : undefined;
  if (repository) {
    for (const c of repository.conflicts)
      if (!compat.incompatibilities.includes(c)) needsApproval.push(`In your repository: ${c}`);
    if (!repository.compatible) compat.compatible = false;
  }
  return {
    id: input.id,
    need: input.need,
    state: "planned",
    stack: input.stack,
    capability,
    components: [...components.values()].map(({ id, version, license, why }) => ({
      id,
      version,
      license,
      why,
    })),
    compatible: compat.compatible,
    incompatibilities: compat.incompatibilities,
    missing: [
      ...compat.missing,
      ...input.gaps.map(
        (g) =>
          `${input.labels?.(g) ?? g}: no verified component yet — TurbineH writes it during generation and verifies it with the rest`,
      ),
      ...(input.notCovered ?? []),
    ],
    decisions: input.decisions,
    files:
      input.stack.source === "declared" && kind === "use_case"
        ? standaloneFiles(input.slug)
        : plannedFiles(input.slug, deps.added.length, envCount, repository?.namespace),
    dependencies: deps.added,
    config,
    estimate: input.useCase
      ? {
          seconds: MEASURED.flowSeconds,
          costUsd: MEASURED.flowModelCostUsd,
          tokens: MEASURED.flowTokens,
          newLinesToMaintain: external * 30 + input.gaps.length * 80,
        }
      : { seconds: MEASURED.componentSeconds, costUsd: 0, tokens: 0, newLinesToMaintain: 0 },
    needsApproval,
    ...(repository ? { repository } : {}),
    outcome: planOutcome(input.stack, kind),
    left: leftItems({
      gaps: input.gaps,
      notCovered: input.notCovered ?? [],
      ...(input.labels ? { label: input.labels } : {}),
    }),
  };
}

/** A decision from the selection step, in plain words (no engine internals). */
export function decisionFromSelection(d: {
  capability: string;
  best: { id: string; p: number } | null;
  ranked: { id: string }[];
  label?: string;
}): Decision | null {
  if (!d.best) return null;
  return {
    topic: d.capability,
    choice: d.best.id,
    why: `Best verified fit for ${d.label ?? d.capability} in this flow (security, licence and compatibility checked before selection).`,
    alternatives: d.ranked
      .map((r) => r.id)
      .filter((id) => id !== d.best?.id)
      .slice(0, 3),
    confidence: Math.round(d.best.p * 100) / 100,
  };
}

export const catalogToPlanned = (
  c: CatalogEntry,
  capability: string,
  why: string,
): PlannedComponent => ({
  id: c.id,
  version: c.version,
  license: c.license,
  purl: c.purl,
  capability,
  why,
});
