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
  /** Only a declared stack: adapting to the concrete project stays pending (stated to the user). */
  adaptationPending: boolean;
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
