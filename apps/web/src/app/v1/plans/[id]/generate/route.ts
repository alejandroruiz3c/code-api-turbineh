import { costToday, requeueForGeneration } from "@turbineh/db";
import { productError } from "@turbineh/engine";
import type { Plan } from "@turbineh/shared";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";

/**
 * POST /v1/plans/{id}/generate — approve the plan and generate the package (assemble, integrate, verify in the
 * sandbox). Decisions that need a person must be acknowledged with `{"approve": true}`.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const row = await ownedFlow(caller, id);
  if (row instanceof Response) return row;
  const plan = row.metrics.plan as Plan | undefined;
  if (row.options.mode !== "plan" || row.status !== "done" || !plan) {
    return productProblem(
      409,
      row.options.mode === "generate"
        ? productError(
            "already_generating",
            "This plan is already generated or being generated.",
            `Follow it at /v1/plans/${id}.`,
          )
        : productError(
            "plan_not_ready",
            "The plan is not ready yet.",
            "Wait until its state is `planned`.",
            `turbineh status ${id}`,
          ),
    );
  }
  const body = (await req.json().catch(() => ({}))) as { approve?: boolean };
  if (plan.needsApproval.length > 0 && body.approve !== true) {
    return productProblem(
      409,
      productError(
        "needs_approval",
        `The plan has ${plan.needsApproval.length} decision(s) that need a person: ${plan.needsApproval.join(" · ")}`,
        'Review them and send {"approve": true} to continue.',
        `turbineh apply ${id} --approve`,
      ),
    );
  }
  if ((await costToday(db)).eur >= env.DAILY_COST_CAP_EUR) {
    return productProblem(
      503,
      productError("capacity", "Today's capacity is used up.", "Try again tomorrow."),
    );
  }
  if (!(await requeueForGeneration(db, id, caller.ownerId))) {
    return productProblem(
      409,
      productError("conflict", "The plan changed state.", `Check it at /v1/plans/${id}.`),
    );
  }
  return Response.json(
    {
      id,
      state: "generating",
      status_url: `/v1/plans/${id}`,
      events_url: `/v1/plans/${id}/events`,
    },
    { status: 202 },
  );
}
