import { buildsLastDay, costToday, enqueueBuild, findImprovement, getBuild } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

/**
 * POST /v1/builds/{id}/improve — "Improve & redeliver". Queues a new build that restores this build's repository,
 * lets the security specialist fix every remaining alert (including development-only advisories), verifies
 * everything again and delivers a new package. The original build is never modified. Allowed once per build and
 * never on an improvement build: the second delivery is final.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller)
    return problem(
      401,
      "Unauthorized",
      "Sign in with GitHub or send `Authorization: Bearer <api_key>`.",
    );
  const parent = await getBuild(db, id, caller.ownerId);
  if (!parent) return problem(404, "Build not found");
  if (parent.status !== "done") return problem(409, "Build is not finished");
  if (parent.options.mode === "improve") {
    return problem(
      409,
      "This is already the improved, final version",
      "An improvement can be requested only once.",
    );
  }
  const existing = await findImprovement(db, id, caller.ownerId);
  if (existing) {
    return problem(
      409,
      "Improvement already requested",
      "An improvement can be requested only once.",
      {
        build_id: existing.id,
      },
    );
  }
  const estimate = (parent.metrics as { improvement?: { fixable?: number } | null }).improvement;
  if (!estimate?.fixable) {
    return problem(
      409,
      "Nothing can be improved automatically",
      "The remaining alerts are explained in the report.",
    );
  }
  const quota = caller.kind === "api-key" ? caller.dailyQuota : env.USER_DAILY_BUILDS;
  if ((await buildsLastDay(db, caller.ownerId)) >= quota) {
    return problem(
      429,
      "Daily build quota reached",
      `You can start ${quota} builds per day during the beta.`,
    );
  }
  if ((await costToday(db)).eur >= env.DAILY_COST_CAP_EUR) {
    return problem(
      503,
      "The beta is at capacity",
      "Today's build capacity is used up. Please come back tomorrow.",
      { waitlist: true },
    );
  }
  const idempotencyKey = `improve:${id}`;
  const { id: buildId, created } = await enqueueBuild(db, {
    prompt: parent.prompt,
    ownerId: caller.ownerId,
    ...(caller.kind === "api-key" ? { apiKeyId: caller.apiKeyId } : {}),
    idempotencyKey,
    options: { mode: "improve", parent: id },
  });
  return Response.json(
    {
      build_id: buildId,
      created,
      parent: id,
      status_url: `/v1/builds/${buildId}`,
      events_url: `/v1/builds/${buildId}/events`,
    },
    { status: created ? 202 : 200 },
  );
}
