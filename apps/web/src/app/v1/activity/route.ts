import { listFlows } from "@turbineh/db";
import { flowState, trackedTokens } from "@turbineh/engine";
import type { Plan } from "@turbineh/shared";
import { db } from "@/server/db";
import { requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

/**
 * GET /v1/activity — the workspace's flows and totals: states, time, tokens spent by TurbineH, code reused from
 * audited components, checks and security findings. Internal cost is never included.
 */
export async function GET(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
  const rows = await listFlows(db, caller.ownerId, limit);
  const flows = rows.map((r) => {
    const plan = r.metrics.plan as Plan | undefined;
    const checks = (r.metrics.verify as { ok: boolean }[] | undefined) ?? [];
    const timings = r.metrics.timings as { total?: number } | undefined;
    return {
      id: r.id,
      need: r.need,
      state: flowState({
        id: r.id,
        status: r.status,
        options: r.options,
        metrics: r.metrics,
        artifact: r.artifact,
        error: r.error,
      }),
      capability: plan
        ? { id: plan.capability.id, name: plan.capability.name, kind: plan.capability.kind }
        : null,
      components: plan?.components.length ?? 0,
      checks: { passed: checks.filter((c) => c.ok).length, total: checks.length },
      seconds: Math.round((timings?.total ?? 0) / 1000),
      tokens: trackedTokens(r.metrics),
      reusedShare: (r.metrics.reuse as { reusedShare?: number } | undefined)?.reusedShare ?? null,
      securityFindings: (r.metrics.handover as { alerts?: number } | undefined)?.alerts ?? null,
      integrations: ((r.metrics.integrations as unknown[] | undefined) ?? []).length,
      package: Boolean((r.artifact as { package?: unknown } | null)?.package),
      created_at: r.created_at,
      finished_at: r.finished_at,
    };
  });
  const done = flows.filter((f) =>
    ["verified", "integrated", "integration_verified", "deployed"].includes(f.state),
  );
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return Response.json(
    {
      totals: {
        flows: flows.length,
        verified: done.length,
        integrated: flows.filter(
          (f) => f.state === "integrated" || f.state === "integration_verified",
        ).length,
        tokens: flows.reduce((a, f) => a + f.tokens, 0),
        avgSecondsToVerified: Math.round(avg(done.map((f) => f.seconds))),
        avgReusedShare: Number(avg(done.map((f) => f.reusedShare ?? 0)).toFixed(3)),
        securityFindings: done.reduce((a, f) => a + (f.securityFindings ?? 0), 0),
      },
      flows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
