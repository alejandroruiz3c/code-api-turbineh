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
}

export interface Requirement {
  kind: "env" | "service" | "step";
  name: string; // e.g. "STRIPE_SECRET_KEY"
  why: string;
  satisfied: boolean;
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
  estimate: { seconds: number; costUsd: number; tokens: number; newLinesToMaintain: number };
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
   * requirements are listed here and the choice is in `needsApproval`). Uncovered requests never get a plan.
   */
  scope?: PlanScope;
}

/** One requirement of the request and whether the library covers it (ADR-0052). */
export interface ScopeRequirement {
  requirement: string;
  covered: boolean;
  /** How it was decided: a shipped test, a catalogue component, the use case, or why it is not covered. */
  why: string;
}

export interface PlanScope {
  status: "covered" | "partial";
  /** The covered use case (recipe id) or "components" when the plan is the components the person chose. */
  useCase: string;
  /** Explicit name of what is built, e.g. "Bookings app (covered part only)". */
  name: string;
  /** Requirements removed from scope because the library does not cover them yet (never "left" work). */
  removed: ScopeRequirement[];
  /** One sentence for people. */
  message: string;
}

export interface PlanCriterion {
  criterion: string;
  status: "covered" | "open";
  tests: string[];
}

export interface CheckResult {
  name: string; // lint, typecheck, unit, build, e2e, secrets, static, dependencies, licenses
  ok: boolean;
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
   * shows ("Checks 11/11 · Requirements 6/8 met"); "verified" alone is never shown while requirements are open.
   */
  checks?: { passed: number; total: number };
  requirements?: { met: number; total: number };
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
