import type {
  CheckResult,
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
  return checks.every((c) => c.ok) ? "verified" : "generated";
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
  };
}
