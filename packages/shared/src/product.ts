import type { DeliveryManifest, DeliveryWay, Justification } from "./delivery.js";

/**
 * Product engine contract (PLAN §16.4): the same states, results and errors for the web UI, the HTTP API and the
 * `turbineh` CLI (human output and `--json`). Changing a shape here is a contract change for all three.
 */

/** Precise lifecycle states — never "ready" while credentials or checks are missing (PLAN §16.2). */
export type FlowState =
  | "planning" // the plan is being prepared (understanding the need, selecting components)
  | "planned" // plan built, not generated yet
  | "generating"
  | "generated" // package produced, not verified yet
  | "verified" // package generated and verified in the TurbineH sandbox
  | "integrated" // changes applied in the client's project
  | "integration_verified" // checks also passed inside the client's project
  | "deployed"
  | "failed";

/** Actionable error: what happened, what to do, and how to resume from where it stopped. */
export interface ProductError {
  code: string; // stable, machine-readable, e.g. "missing_env", "incompatible_stack", "verification_failed"
  message: string; // one sentence for people
  action: string; // the concrete next step, e.g. "Set STRIPE_SECRET_KEY in .env.local"
  resume?: string; // e.g. "turbineh apply --resume pl_123"
  /** `use_case_not_covered` (ADR-0052): the requirements of the request the library does not cover yet. */
  notCovered?: string[];
  /**
   * `use_case_not_covered` (ADR-0062): the full explanation — what is not covered and why, the priority notice and
   * what TurbineH can do now (a components-only offer when verified components serve part of the request).
   */
  explanation?: NotCoveredExplanation;
}

export interface Requirement {
  kind: "env" | "service" | "step";
  name: string; // e.g. "STRIPE_SECRET_KEY"
  why: string;
  satisfied: boolean;
  /**
   * Settings (ADR-0064): true when the app cannot do what was asked without it, false when it is optional — from the
   * app's single env schema (src/env.ts + declared component settings), the same split in every surface.
   */
  required?: boolean;
}

export interface CapabilitySummary {
  id: string; // use case (recipe) or component id
  kind: "use_case" | "component";
  name: string;
  summary: string;
  components: number; // verified components it brings
  stacks: string[]; // e.g. ["nextjs@16", "postgres"]
  requirements: Requirement[];
  example: string; // what the runnable example shows
  /**
   * Components: where the example comes from and, for TypeScript, the pinned packages and date it compiled against
   * (ADR-0066). Absent when the example is a description rather than code.
   */
  exampleCheck?: {
    kind: "typescript" | "app" | "json" | "shell";
    from: string;
    compiled?: { against: string[]; typescript: string; on: string };
  };
  /** Components: when to use it and not, trade-offs, limits, keywords, tested guarantees (guide.yaml). */
  docs?: {
    useWhen: string[];
    avoidWhen: { instead: string; why: string }[];
    tradeoffs: string[];
    limits: string[];
    keywords: string[];
    testedGuarantees: number;
  };
}

export interface EnvironmentInput {
  /** One of: a connected repository, uploaded files (manifests only are enough), or a declared stack. */
  repo?: { provider: "github"; fullName: string; ref?: string };
  files?: Record<string, string>; // path → content (package.json, lockfile, tsconfig, framework config…)
  stack?: { language: string; framework?: string; versions?: Record<string, string> };
}

export interface DetectedStack {
  language: string;
  framework: string | null;
  packageManager: string | null;
  versions: Record<string, string>;
  source: "repo" | "files" | "declared";
  /**
   * Kept for contract compatibility; always false since ADR-0050. A declared stack (no repository, no files) builds
   * a new, complete app, so there is no existing project left to adapt — `Plan.outcome` says what the person gets.
   */
  adaptationPending: boolean;
}

/** A one-click next step offered with a plan (web buttons, CLI hints, MCP). The first one is the recommended one. */
export interface PlanAction {
  id: "generate" | "build_nextjs_app" | "connect_repo" | "upload_files";
  label: string; // button text, e.g. "Generate the complete app"
  detail: string; // one sentence: what happens when you choose it
}

/**
 * What the person gets from a plan, in plain words (ADR-0050): what happened, what it means for them and the next
 * actions. Deterministic (stack + plan kind), never a model.
 */
export interface PlanOutcome {
  kind: "complete_app" | "server_modules" | "separate_service" | "project_changes";
  title: string; // e.g. "A complete Next.js app, built for you"
  meaning: string; // what it means for the person
  notes: string[]; // short facts worth knowing (versions used, what is not converted…)
  actions: PlanAction[];
}

/** One part of the need that is still open after generation, and where it is implemented (ADR-0050). */
export interface PlanLeftItem {
  part: string; // e.g. "Export invoices to PDF"
  why: string; // why it is still open
  where: string; // where to implement it, e.g. "src/app/(app)/invoices — AGENTS.md › What is left"
}

export interface Decision {
  topic: string; // e.g. "payments.checkout"
  choice: string; // component id or option
  why: string; // reason in plain words
  alternatives: string[];
  confidence: number; // 0..1
  /** How the capability is delivered (ADR-0064): a verified component, written by TurbineH, or not included. */
  way?: DeliveryWay;
  /** What in the request justifies it (ADR-0064): criteria, stated requirements, transversal requirements. */
  justifiedBy?: Justification[];
}

export interface FileChange {
  path: string;
  action: "add" | "modify";
  why: string;
}

/**
 * How a plan fits a connected repository (PLAN §16 P5): stack and conventions found by the analysis, conflicts and
 * the adaptation decisions taken, with their reasons. Present only when the environment is a repository.
 */
export interface RepositoryFit {
  repo: string;
  ref: string;
  appPath: string;
  stack: {
    language: string;
    framework: string | null;
    version: string | null;
    router: string | null;
    packageManager: string | null;
  };
  conventions: string[];
  conflicts: string[];
  decisions: { topic: string; choice: string; why: string }[];
  compatible: boolean;
  /** Folder where the capability lands in the project, e.g. "src/turbineh/ai-assistant". */
  namespace: string;
}

/** A p50–p90 interval of finished runs (ADR-0066). */
export interface EstimateRange {
  p50: number;
  p90: number;
}

/**
 * Where a plan's estimate comes from (ADR-0066). `history`: the last finished runs of the same recipe (time from the
 * generation being queued to its persisted end, tracked model tokens, new lines written). `benchmark`: fewer than
 * `minSamples` such runs, so the benchmark average is shown as a single value and labelled as such.
 */
export interface EstimateCalibration {
  basis: "history" | "benchmark";
  recipe: string | null;
  samples: number;
  minSamples: number;
  /** Runs each figure was calibrated on (the most recent ones; history basis only). */
  window?: { seconds: number; tokens: number; lines: number };
  seconds: EstimateRange;
  tokens: EstimateRange;
  newLinesToMaintain: EstimateRange;
}

/** A finished flow's estimate next to what it really took (ADR-0066), from persisted values only. */
export interface EstimateVsActual {
  estimate: Plan["estimate"];
  actual: { seconds: number | null; tokens: number | null; newLinesToMaintain: number | null };
}

export interface Plan {
  id: string;
  need: string;
  state: FlowState;
  stack: DetectedStack;
  capability: CapabilitySummary;
  components: { id: string; version: string; license: string; why: string }[];
  compatible: boolean;
  incompatibilities: string[];
  missing: string[];
  decisions: Decision[];
  files: FileChange[];
  dependencies: { name: string; version: string }[];
  config: Requirement[];
  /**
   * Point values are the median (p50). `calibration` (ADR-0066) says where they come from: finished runs of the same
   * recipe (`history`, with the p50–p90 interval) or, with too few runs, the benchmark average (`benchmark`).
   */
  estimate: {
    seconds: number;
    costUsd: number;
    tokens: number;
    newLinesToMaintain: number;
    calibration?: EstimateCalibration;
  };
  /** Decisions that need a person (incompatibility, relevant choice, action outside the project policy). */
  needsApproval: string[];
  /** Only when the environment is a connected repository. */
  repository?: RepositoryFit;
  /**
   * The request's acceptance criteria as compiled, and whether a test shipped with the selected recipe/components
   * will prove each one (`covered`, becomes `met` when the gate passes) or nothing does yet (`open`). Matching is code
   * (acceptance.yaml rules), never a model. Lets a coding agent start on the open ones while the package builds.
   */
  criteria?: PlanCriterion[];
  /** What the person gets and the next actions (ADR-0050). */
  outcome?: PlanOutcome;
  /** What stays open after generation, each with where to implement it (ADR-0050). Never blocks generation. */
  left?: PlanLeftItem[];
  /**
   * Scope gate (ADR-0052): what the library covers of the request. A plan exists only when its use case is covered
   * (`covered`), or when the person must explicitly choose to build the covered part only (`partial`: the removed
   * requirements are listed here and the choice is in `needsApproval`). An uncovered use case never gets a plan of
   * itself; when verified components serve part of it, the plan is a components-only offer (`components_only`,
   * ADR-0062) that needs the person's approval and never builds the use case.
   */
  scope?: PlanScope;
  /**
   * The delivery manifest (ADR-0064): the single source of truth this plan was rendered from — every decision with
   * what justifies it, the criteria, the settings (required / optional) and what is not included.
   */
  delivery?: DeliveryManifest;
}

/** One requirement of the request and whether the library covers it (ADR-0052). */
export interface ScopeRequirement {
  requirement: string;
  covered: boolean;
  /** How it was decided: a shipped test, a catalogue component, the use case, or why it is not covered. */
  why: string;
}

export interface PlanScope {
  status: "covered" | "partial" | "components_only";
  /** The covered use case (recipe id) or "components" when the plan is the components the person chose. */
  useCase: string;
  /** Explicit name of what is built, e.g. "Bookings app (covered part only)". */
  name: string;
  /** Requirements removed from scope because the library does not cover them yet (never "left" work). */
  removed: ScopeRequirement[];
  /** One sentence for people. */
  message: string;
  /** `components_only` (ADR-0062): what is not covered, the priority notice and the offer. */
  explanation?: NotCoveredExplanation;
}

/**
 * A request whose use case the library does not cover, explained the same way on the web, the API, the CLI and MCP
 * (ADR-0062): what is not covered yet and why, that the person is notified with priority, and what TurbineH can do now.
 */
export interface NotCoveredExplanation {
  /** "The library doesn't cover this use case yet". */
  title: string;
  /** The use case in the person's own words (the request's headline). */
  useCase: string;
  /** Each requirement the library doesn't cover yet, with why in plain words. */
  notCovered: ScopeRequirement[];
  /** The priority notice (demand recorded; email when the account's address is known). */
  priority: string;
  /** What TurbineH can do now: the offer below, or how to continue within what is covered. */
  canDoNow: string;
  /** Verified components that serve part of the request; null when none applies. */
  offer: ComponentOffer | null;
}

/** A verified component offered for an uncovered use case and the requirements it serves (ADR-0062). */
export interface OfferedComponent {
  id: string;
  /** What it does (its manifest), as it was verified. */
  does: string;
  /** The functional result the person gets from it, in plain words (e.g. "online payments with Stripe Checkout"). */
  gives: string;
  /** Requirements of the request it implements (stated by the person, mapped one by one). */
  serves: string[];
  /** Evidence per mapped requirement: the verified test (acceptance rule or tested guarantee) that proves it. */
  proof: { requirement: string; test: string }[];
  /** Present when it is included because an offered component declares it (`relations.requires`). */
  requiredBy?: string;
}

/**
 * Components-only package offered when the use case is not covered but verified components serve part of it
 * (ADR-0062). Built only after the person approves; delivered exactly as verified; the use case itself is never built.
 */
export interface ComponentOffer {
  kind: "components_only";
  /** "Verified components for your <need>: auth, scheduled jobs, …" */
  title: string;
  /** Name of the package that would be built. */
  name: string;
  /** "You get … working" — the functional result, plainly. */
  youGet: string;
  /** "Not included: …" — what of the request is not delivered, naming the core when it is the core. */
  notIncluded: string;
  /** True when the uncovered part is the core of the request (its use case itself). */
  coreNotIncluded: boolean;
  components: OfferedComponent[];
  /** Requirements no offered component serves: out of the package's scope (never built, never faked). */
  outOfScope: ScopeRequirement[];
  /** How to accept it on each surface. */
  approve: { web: string; api: string; cli: string; mcp: string };
}

export interface PlanCriterion {
  criterion: string;
  status: "covered" | "open";
  tests: string[];
  /** Canonical criteria of the use case this criterion is (ADR-0063): proven by their linked tests. */
  canonical?: string[];
  /** The request's own wording, when the plan uses the canonical one (ADR-0063). */
  asked?: string[];
}

export interface CheckResult {
  name: string; // lint, typecheck, unit, build, e2e, secrets, static, dependencies, licenses
  ok: boolean;
  /** Passed with this many non-blocking findings left (ADR-0065): "pass with warnings", never a plain pass. */
  warnings?: number;
  detail?: string;
}

/** What every result shows first: what works and what still needs configuration (PLAN §16.2). */
export interface FlowResult {
  planId: string;
  state: FlowState;
  works: string[];
  needs: Requirement[];
  checks: CheckResult[];
  package: { zipUrl: string | null; manifestUrl: string | null };
  try: { command: string; description: string } | null; // runnable example
  continue: string; // instructions for a person or Claude Code
  revert: string; // how to undo without losing later work
  agentInstructions: string; // copyable text for the coding agent
  metrics: {
    seconds: number;
    tokens: number;
    reusedShare: number;
    securityFindings: number;
    newLines: number;
  };
  errors: ProductError[];
  /** The end state in plain words with its next actions (ADR-0051): the same text on the web, the API and the CLI. */
  outcome?: FlowOutcome;
}

/** A one-click next step offered on a result (ADR-0051). */
export interface FlowOutcomeAction {
  id:
    | "open_pull_request"
    | "download_zip"
    | "apply_cli"
    | "try_example"
    | "generate_again"
    | "new_flow";
  label: string; // e.g. "Open a pull request"
  detail: string; // what happens when you choose it
  command?: string; // CLI equivalent, e.g. "turbineh apply 470bc606-…"
}

/**
 * What a flow ended with (or what it is doing), derived by code from the same row as `FlowState` (ADR-0051), so the
 * state badge, the API (`outcome` next to `problem`) and the CLI never disagree.
 */
export interface FlowOutcome {
  kind:
    | "working"
    | "planned"
    | "package_verified"
    | "package_unverified"
    | "app_verified"
    | "app_unverified"
    | "integrated"
    | "deployed"
    | "failed";
  state: FlowState;
  title: string; // e.g. "Package ready (not verified yet: it is verified inside your project when you integrate it)"
  meaning: string; // what it means for the person
  verification: string; // what was checked, or why nothing was checked yet
  actions: FlowOutcomeAction[];
  left: string[]; // what is left to do, in order
  /**
   * F18 (ADR-0052): build checks and the request's requirements, kept apart. `badge` is the one line every client
   * shows (ADR-0063 verdict: "Technically verified · checks 11/11 · functional 6/8"); "verified" alone only at ≥ 80 %.
   */
  /** `warnings`: passed checks with non-blocking findings left (ADR-0065). */
  checks?: { passed: number; total: number; warnings?: number };
  requirements?: { met: number; total: number };
  /**
   * Functional coverage (ADR-0063, audit v2 F-01): requirements a passing test proves / requirements derived from the
   * request, with the same weight as the checks. "Verified" without a qualifier only at `ratio >= threshold`.
   */
  functional?: { met: number; total: number; ratio: number; threshold: number };
  badge?: string;
}

/** Project preferences reused by the CLI and Claude Code (`.turbineh/project.json`). */
export interface ProjectPreferences {
  stack?: Partial<DetectedStack>;
  approvedComponents?: string[];
  conventions?: { srcDir?: string; testDir?: string; envFile?: string; packageManager?: string };
  changePolicy?: {
    autoApply: "never" | "safe" | "always";
    allowDependencyChanges: boolean;
    allowNewEnv: boolean;
  };
}
