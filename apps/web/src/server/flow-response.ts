import { findImprovement, type BuildRow } from "@turbineh/db";
import {
  appQuickstart,
  estimateVsActual,
  explainFailure,
  flowDurationMs,
  flowOutcome,
  flowState,
} from "@turbineh/engine";
import type { Plan } from "@turbineh/shared";
import type { Caller } from "./caller";
import { db } from "./db";
import { clientMetrics, isOps } from "./ops";
import { storage } from "./storage";

/**
 * The body of GET /v1/builds/{id}, also rendered by the flow page on the server (N-03, ADR-0066): a finished flow is
 * shown from its persisted state at once, never from an optimistic "Generating · 0 s".
 */
export async function buildResponse(build: BuildRow, caller: Caller) {
  const finished = build.status === "done" || build.status === "failed";
  const improvement =
    build.options.mode === "improve" ? null : await findImprovement(db, build.id, caller.ownerId);
  const a = build.artifact as {
    zipKey?: string;
    bundleKey?: string;
    files?: string[];
    docs?: Record<string, string>;
    scripts?: Record<string, string>;
    slug?: string;
    previews?: { name: string; key: string }[];
    reportOnly?: boolean;
  } | null;
  // ADR-0037 §D1: what was delivered. `verified` is true only when every check passed; a failed gate may still deliver
  // the package ("Delivered, not verified: N/M") or, on a security/policy block, only the report.
  const d = build.metrics.delivery as
    | {
        kind: "verified" | "unverified" | "report_only";
        label: string;
        checksPassed: number;
        checksTotal: number;
        failures: unknown[];
        blocking: unknown[];
      }
    | undefined;
  const verified = build.status === "done" && (d ? d.kind === "verified" : true);
  // The capability package (component-only flows deliver only this, ADR-0051).
  const pkg = (a as { package?: { slug?: string; zipKey?: string; manifestKey?: string } } | null)
    ?.package;
  const row = {
    id: build.id,
    status: build.status,
    options: build.options,
    metrics: build.metrics,
    artifact: build.artifact,
    error: build.error,
  };
  return {
    id: build.id,
    status: build.status,
    prompt: build.prompt,
    created_at: build.created_at,
    started_at: build.started_at ?? null,
    finished_at: build.finished_at,
    // N-03 (ADR-0066): persisted end − persisted start of the current run; null while it runs. Never "now − start".
    duration_ms: finished ? flowDurationMs(build.started_at, build.finished_at) : null,
    // F-06 (ADR-0066): the plan's estimate next to what this run really took (persisted values only).
    estimate_vs_actual: estimateVsActual(build.metrics.plan as Plan | undefined, {
      startedAt: build.started_at ?? null,
      finishedAt: build.finished_at,
      metrics: build.metrics,
      finished: finished && build.options.mode !== "plan",
    }),
    error: build.error,
    // The same state and end-state text as /v1/plans/{id} and the CLI (ADR-0051): never derived again by a client.
    state: flowState(row),
    outcome: flowOutcome(row),
    package: pkg?.zipKey
      ? {
          slug: pkg.slug ?? null,
          zip_url: await storage.url(pkg.zipKey),
          manifest_url: pkg.manifestKey ? await storage.url(pkg.manifestKey) : null,
        }
      : null,
    // What happened, why, what to do and the next action, in plain words (ADR-0050): never only the raw reason.
    problem:
      build.status === "failed"
        ? explainFailure(build.error, {
            id: build.id,
            fromPlan: build.options.mode === "generate" && Boolean(build.metrics.plan),
            metrics: build.metrics,
          })
        : null,
    verified: build.status === "done" || build.status === "failed" ? verified : null,
    delivery: d
      ? {
          kind: d.kind,
          label: d.label,
          checks_passed: d.checksPassed,
          checks_total: d.checksTotal,
          failures: d.failures,
          blocking: d.blocking,
        }
      : null,
    spec: build.spec,
    // Cost is internal: only TurbineH staff see it.
    metrics: isOps(caller) ? build.metrics : clientMetrics(build.metrics),
    repo_url: build.repo_url,
    improved_from: build.options.mode === "improve" ? (build.options.parent ?? null) : null,
    improvement_build_id: improvement?.id ?? null,
    artifact: a?.zipKey
      ? {
          slug: a.slug,
          zip_url: await storage.url(a.zipKey),
          bundle_url: a.bundleKey ? await storage.url(a.bundleKey) : null,
          files: a.files ?? [],
          // F20: how to run it, from the delivered app's real files and package.json scripts.
          quickstart: appQuickstart({
            slug: a.slug ?? "app",
            files: a.files ?? [],
            scripts: a.scripts ?? null,
          }),
          docs: a.docs ?? {},
          previews: await Promise.all(
            (a.previews ?? []).map(async (p) => ({ name: p.name, url: await storage.url(p.key) })),
          ),
          verified,
        }
      : a?.reportOnly
        ? // Security or policy block: the report only, never runnable code.
          {
            slug: a.slug,
            zip_url: null,
            bundle_url: null,
            files: [],
            docs: a.docs ?? {},
            previews: [],
            verified: false,
            report_only: true,
          }
        : null,
  };
}
