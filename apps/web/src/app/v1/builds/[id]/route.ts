import { findImprovement, getBuild } from "@turbineh/db";
import { explainFailure } from "@turbineh/engine";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { clientMetrics, isOps } from "@/server/ops";
import { problem } from "@/server/problem";
import { storage } from "@/server/storage";

const UUID = /^[0-9a-f-]{36}$/;

/** GET /v1/builds/{id} — status, metrics, artefact links, repository URL and feedback. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (!UUID.test(id)) return problem(404, "Build not found");
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) return problem(404, "Build not found");
  const improvement = build.options.mode === "improve" ? null : await findImprovement(db, id, caller.ownerId);
  const a = build.artifact as {
    zipKey?: string;
    bundleKey?: string;
    files?: string[];
    docs?: Record<string, string>;
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
  return Response.json({
    id: build.id,
    status: build.status,
    prompt: build.prompt,
    created_at: build.created_at,
    finished_at: build.finished_at,
    error: build.error,
    // What happened, why, what to do and the next action, in plain words (ADR-0050): never only the raw reason.
    problem:
      build.status === "failed"
        ? explainFailure(build.error, {
            id: build.id,
            fromPlan: build.options.mode === "generate" && Boolean(build.metrics.plan),
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
  });
}
