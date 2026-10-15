import type {
  CheckResult,
  FlowOutcome,
  FlowOutcomeAction,
  FlowResult,
  FlowState,
  Plan,
  ProductError,
  Requirement,
} from "@turbineh/shared";
import { ERRORS } from "./errors.js";
import { asProductError, explainFailure } from "./messages.js";

/** The parts of a build row the product reads (the same row carries the plan and the generation). */
export interface FlowRow {
  id: string;
  status: string;
  options: Record<string, unknown>;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown> | null;
  error: string | null;
}

export interface IntegrationRecord {
  id: string;
  state: "integrated" | "integration_verified" | "reverted" | "integration_failed";
  at: string;
  branch?: string;
  commit?: string;
  where?: "local" | "github";
  pullRequest?: string;
  checks?: CheckResult[];
}

type Usage = { input_tokens: number; output_tokens: number };

/** Tokens TurbineH spent on this flow (compiler, glue, Backup Coder, corrections) — what reuse saves elsewhere. */
export function trackedTokens(m: Record<string, unknown>): number {
  const n = (u?: Partial<Usage>) => (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0);
  const tokens = m.tokens as { compiler?: Usage } | undefined;
  const sum = (xs: unknown) =>
    ((xs as { usage?: Usage }[] | undefined) ?? []).reduce((a, x) => a + n(x.usage), 0);
  const backup = (m.backup as { activations?: unknown } | undefined)?.activations;
  return n(tokens?.compiler) + sum(m.integrated) + sum(backup) + sum(m.corrections);
}

const CHECK_LABEL: Record<string, string> = {
  install: "Dependencies install offline",
  migrations: "Database migrations generate",
  lint: "Lint",
  typecheck: "Strict type check",
  unit: "Unit tests",
  build: "Production build",
  e2e: "End-to-end tests on a real database",
  secrets: "No secrets in the code",
  static: "Security rules (injection, authorization, XSS…)",
  dependencies: "No known vulnerable dependencies",
  licenses: "Licences allowed",
  certification:
    "Components certified (contract tests, strict types, licences, known vulnerabilities)",
  contract: "Contract tests of the package's components, together in the sandbox (no network)",
};

export const checkLabel = (name: string) => CHECK_LABEL[name] ?? name;

/** The build failed its gate but delivered the package, marked not verified (ADR-0037 §D1). */
export function deliveredUnverified(
  row: Pick<FlowRow, "status" | "metrics" | "artifact">,
): boolean {
  const d = row.metrics.delivery as { kind?: string } | undefined;
  return row.status === "failed" && d?.kind === "unverified" && Boolean(row.artifact?.zipKey);
}

/** "Delivered, not verified: 10/11 checks passed" (or the verified/report-only label), from the build metrics. */
export function deliveryLabel(row: Pick<FlowRow, "metrics">): string | null {
  return ((row.metrics.delivery as { label?: string } | undefined)?.label ?? null) || null;
}

export function flowState(row: FlowRow): FlowState {
  const mode = row.options.mode;
  const integrations = (row.metrics.integrations as IntegrationRecord[] | undefined) ?? [];
  const last = integrations.at(-1);
  if (row.metrics.deployment) return "deployed";
  if (last && (last.state === "integrated" || last.state === "integration_verified"))
    return last.state;
  // ADR-0037 §D1: a failed gate that still delivered its package is "generated" (package produced, not verified) —
  // never "verified", and still not deployable (deploy, improve and pull requests require a passed gate).
  if (row.status === "failed") return deliveredUnverified(row) ? "generated" : "failed";
  if (mode === "plan") return row.status === "done" ? "planned" : "planning";
  if (row.status !== "done") return "generating";
  const checks = (row.metrics.verify as CheckResult[] | undefined) ?? [];
  if (checks.length === 0) return "generated";
  // Packages generated before ADR-0051 recorded only the components' own certification: nothing ran for the package
  // in the sandbox, so it is "generated" (verified inside the project when integrated), never "verified".
  if (checks.every((c) => c.name === "certification")) return "generated";
  return checks.every((c) => c.ok) ? "verified" : "generated";
}

/**
 * F18 (ADR-0052): build checks and the request's requirements, never merged into one "verified". Checks come from the
 * gate (`handover` for complete apps, `verify` for packages); requirements from the acceptance criteria after the gate
 * (`acceptance`: met / covered / open). The badge is the same line on the web, the API and the CLI.
 */
export function checksAndRequirements(
  row: Pick<FlowRow, "metrics">,
): Pick<FlowOutcome, "checks" | "requirements" | "badge"> {
  const m = row.metrics;
  const h = m.handover as { checksPassed?: number; checksTotal?: number } | undefined;
  const verify = ((m.verify as CheckResult[] | undefined) ?? []).filter(
    (c) => c.name !== "certification",
  );
  const checks =
    typeof h?.checksTotal === "number" && h.checksTotal > 0
      ? { passed: h.checksPassed ?? 0, total: h.checksTotal }
      : verify.length > 0
        ? { passed: verify.filter((c) => c.ok).length, total: verify.length }
        : undefined;
  const a = m.acceptance as { met?: number; covered?: number; open?: string[] } | undefined;
  const total = a ? (a.met ?? 0) + (a.covered ?? 0) + (a.open?.length ?? 0) : 0;
  const requirements = a && total > 0 ? { met: a.met ?? 0, total } : undefined;
  const parts = [
    checks ? `Checks ${checks.passed}/${checks.total}` : null,
    requirements ? `Requirements ${requirements.met}/${requirements.total} met` : null,
  ].filter((x): x is string => x !== null);
  return {
    ...(checks ? { checks } : {}),
    ...(requirements ? { requirements } : {}),
    ...(parts.length ? { badge: parts.join(" · ") } : {}),
  };
}

/**
 * F20 (ADR-0052): how to run a delivered app, from its real files and package.json scripts (stored with the artefact),
 * never a fixed text: no `db:seed` when the template has none, `.env.example` where it really is.
 */
export function appQuickstart(input: {
  slug: string;
  files: readonly string[];
  /** package.json scripts (name → command) of the delivered app; null for builds stored before they were recorded. */
  scripts?: Record<string, string> | null;
}): string[] {
  const scripts: Record<string, string> =
    input.scripts ??
    (input.files.includes("package.json")
      ? {
          dev: "next dev",
          ...(input.files.includes("scripts/migrate.ts") ? { "db:migrate": "migrate" } : {}),
        }
      : {});
  const env = input.files.includes(".env.example")
    ? ".env.example"
    : input.files.includes("config/.env.example")
      ? "config/.env.example"
      : null;
  const autoMigrate = /--migrate\b/.test(scripts.dev ?? "");
  const lines = [`unzip ${input.slug}.zip && cd ${input.slug}`, "pnpm install"];
  if (env) lines.push(`cp ${env} .env.local     # fill the values listed under "Settings"`);
  if (scripts["db:migrate"] && !autoMigrate) lines.push("pnpm db:migrate");
  if (scripts["db:seed"]) lines.push("pnpm db:seed");
  if (scripts.dev)
    lines.push(
      autoMigrate
        ? "pnpm dev                       # without DATABASE_URL it starts a local PostgreSQL and migrates it"
        : "pnpm dev",
    );
  return lines;
}

/** The not-verified-yet title of a capability package (ADR-0051). Shared by the web, the API and the CLI. */
export const PACKAGE_NOT_VERIFIED_TITLE =
  "Package ready (not verified yet: it is verified inside your project when you integrate it)";

/**
 * The end state in plain words and its next actions (ADR-0051), from the same row as `flowState`, so the badge, the
 * API and the CLI say the same. Deterministic: no model.
 */
export function flowOutcome(row: FlowRow): FlowOutcome {
  const o = stateOutcome(row);
  if (o.kind === "working" || o.kind === "planned" || o.kind === "failed") return o;
  const s = checksAndRequirements(row);
  const open = s.requirements ? s.requirements.total - s.requirements.met : 0;
  // F18: passing checks never read as "everything the request asked for is done" while requirements are open.
  const title =
    o.kind === "app_verified" && open > 0
      ? `Build checks passed in the TurbineH sandbox · ${open} requirement(s) not met yet`
      : o.title;
  return { ...o, title, ...s };
}

function stateOutcome(row: FlowRow): FlowOutcome {
  const state = flowState(row);
  const plan = row.metrics.plan as Plan | undefined;
  const pkg = row.artifact?.package as { slug?: string } | undefined;
  const slug = String(pkg?.slug ?? plan?.capability.id ?? "capability");
  const short = row.id.slice(0, 8);
  const componentOnly = plan?.capability.kind === "component" && row.options.mode === "generate";
  const pv = row.metrics.packageVerification as
    | { ran?: boolean; ok?: boolean; summary?: string; failures?: { component: string }[] }
    | undefined;
  const needs = (plan?.config ?? [])
    .filter((r) => !r.satisfied)
    .map((r) => `Set ${r.name}: ${r.why}`);
  const planLeft = (plan?.left ?? []).map((l) => (l.where ? `${l.part} — ${l.where}` : l.part));
  const deps = (plan?.dependencies ?? []).map((d) => `${d.name}@${d.version}`);
  const repo = plan?.repository?.repo;
  const integrationActions: FlowOutcomeAction[] = [
    {
      id: "open_pull_request",
      label: "Open a pull request",
      detail: `${repo ? `Adds it to ${repo}` : "Adds it to your GitHub repository"} on a new branch (turbineh/${slug}), runs your project's checks with it in the sandbox and opens a draft pull request; it is marked ready only when every check passes. Needs GitHub connected; never merged for you.`,
    },
    {
      id: "download_zip",
      label: "Download ZIP",
      detail: `The package: src/, tests/, config/.env.example, docs/ and agent/INTEGRATE.md for you or your coding agent.`,
    },
    {
      id: "apply_cli",
      label: `turbineh apply ${row.id}`,
      command: `turbineh apply ${row.id}`,
      detail: `Writes turbineh/${slug}/ into your project on a new branch turbineh/${slug}-${short} in one commit, adds only the missing dependencies${deps.length ? ` (${deps.join(", ")})` : ""} and the setting names to .env.example; your default branch is never touched. Then \`turbineh verify\` runs your project's checks with it and \`turbineh revert\` undoes only that commit.`,
    },
  ];
  const working = (title: string, meaning: string): FlowOutcome => ({
    kind: "working",
    state,
    title,
    meaning,
    verification: "",
    actions: [],
    left: [],
  });
  if (state === "planning")
    return working("Preparing the plan", "Reading the need and choosing verified components.");
  if (state === "generating")
    return working("Generating", "Assembling and checking the package now.");
  if (state === "planned")
    return {
      kind: "planned",
      state,
      title: "Plan ready",
      meaning: plan
        ? `${plan.components.length} verified component(s) selected. Review it, then generate.`
        : "Review it, then generate.",
      verification: "",
      actions: [],
      left: planLeft,
    };
  if (state === "failed") {
    const p = explainFailure(row.error, {
      id: row.id,
      fromPlan: row.options.mode === "generate" && Boolean(plan),
    });
    return {
      kind: "failed",
      state,
      title: p.title,
      meaning: p.why,
      verification: "",
      actions: [
        p.next.kind === "generate_again"
          ? { id: "generate_again", label: p.next.label, detail: p.action }
          : { id: "new_flow", label: p.next.label, detail: p.action },
      ],
      left: [p.action],
    };
  }
  if (state === "deployed" || state === "integrated" || state === "integration_verified") {
    return {
      kind: state === "deployed" ? "deployed" : "integrated",
      state,
      title:
        state === "deployed"
          ? "Deployed in your own accounts"
          : state === "integration_verified"
            ? "Integrated and verified inside your project"
            : "Integrated in your project, checks pending",
      meaning:
        state === "integrated"
          ? "The changes are in your project; its checks have not all passed yet — run `turbineh verify` or see the pull request."
          : "Nothing left to check on our side.",
      verification: "",
      actions: [],
      left: [...needs, ...planLeft],
    };
  }
  if (componentOnly) {
    const verified = state === "verified";
    const failed = pv?.ran === true && pv.ok === false;
    return {
      kind: verified ? "package_verified" : "package_unverified",
      state,
      title: verified
        ? "Package ready and verified: its contract tests passed in the TurbineH sandbox"
        : PACKAGE_NOT_VERIFIED_TITLE,
      meaning: verified
        ? "It is checked again inside your project when you integrate it (pull request or `turbineh apply` + `turbineh verify`)."
        : failed
          ? `A contract test did not pass in the sandbox (${(pv?.failures ?? []).map((f) => f.component).join(", ")}). The package is delivered so you can see why; fix or replace that component before integrating.`
          : "Each component was certified on its own (contract tests, strict types, licences, known vulnerabilities). The package as a whole is checked inside your project, with your versions, when you integrate it.",
      verification:
        pv?.summary ??
        (verified
          ? "Components certified: contract tests, strict types, licences, known vulnerabilities."
          : "Each component was certified on its own; nothing ran for this package yet."),
      actions: integrationActions,
      left: [
        ...(verified
          ? []
          : ["Verify it inside your project: the pull request's checks or `turbineh verify`"]),
        "Wire it where you use it: agent/INTEGRATE.md lists the entry points",
        ...needs,
        ...planLeft,
      ],
    };
  }
  const verified = state === "verified";
  return {
    kind: verified ? "app_verified" : "app_unverified",
    state,
    title: verified ? "App verified in the TurbineH sandbox" : "Delivered, not verified",
    meaning: verified
      ? "Every check passed: build, tests, end-to-end, secrets, security rules, vulnerabilities and licences."
      : (deliveryLabel(row) ?? "Not every check passed; the failures are listed with the fix."),
    verification: deliveryLabel(row) ?? "",
    actions: [
      { id: "try_example", label: "Try it", detail: "Run it locally with sample data." },
      { id: "download_zip", label: "Download ZIP", detail: "The complete app and its evidence." },
      ...(verified ? [integrationActions[0] as FlowOutcomeAction] : []),
    ],
    left: [...needs, ...planLeft],
  };
}

export function agentInstructions(slug: string): string {
  return `Integrate this package into the project following turbineh/${slug}/agent/INTEGRATE.md. Check compatibility, keep the existing conventions and run the included verifications. Explain any adaptation that is still pending.`;
}

/**
 * FlowResult (PLAN §16.2): what works and what still needs configuration first, then the actions. Never "ready"
 * while credentials or checks are missing: `needs` lists them with the concrete step.
 */
export function flowResult(
  row: FlowRow,
  urls: { zipUrl: string | null; manifestUrl: string | null },
): FlowResult {
  const plan = row.metrics.plan as Plan | undefined;
  const slug = String(
    (row.artifact?.package as { slug?: string } | undefined)?.slug ??
      plan?.capability.id ??
      "capability",
  );
  const checks = ((row.metrics.verify as { name: string; ok: boolean }[] | undefined) ?? []).map(
    (c) => ({
      name: c.name,
      ok: c.ok,
      detail: checkLabel(c.name),
    }),
  );
  const state = flowState(row);
  const integrations = (row.metrics.integrations as IntegrationRecord[] | undefined) ?? [];
  const lastIntegration = integrations.at(-1);
  const needs: Requirement[] = (plan?.config ?? []).filter((r) => !r.satisfied);
  const errors: ProductError[] = [];
  if (deliveredUnverified(row)) {
    errors.push(
      ERRORS.verificationFailed(
        row.id,
        row.error ?? deliveryLabel(row) ?? "Delivered, not verified",
      ),
    );
  }
  const pv = row.metrics.packageVerification as
    { ran?: boolean; ok?: boolean; summary?: string } | undefined;
  if (pv?.ran && !pv.ok && state === "generated") {
    // A capability package whose contract tests did not pass together (ADR-0051): delivered, never "verified".
    errors.push(ERRORS.verificationFailed(row.id, pv.summary ?? "Contract tests did not pass"));
  }
  if (state === "failed") {
    errors.push(
      asProductError(
        explainFailure(row.error, {
          id: row.id,
          fromPlan: row.options.mode === "generate" && Boolean(plan),
        }),
      ),
    );
  }
  const reuse = row.metrics.reuse as { reusedShare?: number; generatedLines?: number } | undefined;
  const timings = row.metrics.timings as { total?: number } | undefined;
  const generated = [
    "generated",
    "verified",
    "integrated",
    "integration_verified",
    "deployed",
  ].includes(state);
  return {
    planId: row.id,
    state,
    works: generated
      ? checks.filter((c) => c.ok).map((c) => c.detail ?? c.name)
      : plan
        ? [`Plan ready: ${plan.components.length} verified components selected`]
        : [],
    needs,
    checks,
    package: urls,
    try: generated
      ? {
          command: `cd turbineh/${slug}/examples/app && cp ../../config/.env.example .env.local && pnpm install && pnpm db:migrate && pnpm dev`,
          description:
            "Runs the verified example with sample data (needs a PostgreSQL URL in .env.local).",
        }
      : null,
    continue: `Open turbineh/${slug}/agent/INTEGRATE.md — it tells a person or a coding agent where to wire the capability, what to configure and how to extend it.`,
    revert: lastIntegration?.commit
      ? `turbineh revert ${lastIntegration.id}  (reverts commit ${lastIntegration.commit.slice(0, 8)} only; later work is kept)`
      : "Nothing applied yet. After `turbineh apply`, `turbineh revert <integration>` reverts that commit only.",
    agentInstructions: agentInstructions(slug),
    metrics: {
      seconds: Math.round((timings?.total ?? 0) / 1000),
      tokens: trackedTokens(row.metrics),
      reusedShare: reuse?.reusedShare ?? 0,
      securityFindings: Number(
        (row.metrics.handover as { alerts?: number } | undefined)?.alerts ?? 0,
      ),
      newLines: reuse?.generatedLines ?? 0,
    },
    errors,
    outcome: flowOutcome(row),
  };
}
