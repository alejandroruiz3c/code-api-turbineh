import type { Plan } from "@turbineh/shared";
import { confirmDemandLater } from "@/server/demand-email";
import { ownedFlow, requireCaller, resultOf } from "@/server/product";

export const dynamic = "force-dynamic";

/**
 * GET /v1/plans/{id} — the plan and the flow result with precise states (planning, planned, generating, verified,
 * integrated, integration_verified, deployed, failed), what works, what needs configuration and the next actions.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const row = await ownedFlow(caller, id);
  if (row instanceof Response) return row;
  // ADR-0056: a refused request gets its priority-list email after this response.
  confirmDemandLater(row);
  const result = await resultOf(row);
  const plan = (row.metrics.plan as Plan | undefined) ?? null;
  // The plan's fields at the top level (same shape as POST /v1/plans) plus the live result.
  return Response.json(
    {
      ...plan,
      id: row.id,
      need: row.prompt,
      state: result.state,
      plan,
      // ADR-0062: an uncovered use case with verified components that serve part of it (approve to build them).
      offer: plan?.scope?.explanation?.offer ?? null,
      result,
      created_at: row.created_at,
      finished_at: row.finished_at,
      events_url: `/v1/plans/${row.id}/events`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
