import {
  aiAppSummary,
  type BuildRow,
  createAiAppToken,
  getBuild,
  revokeAiAppToken,
} from "@turbineh/db";
import { appTokenDefaults } from "@/server/ai-gateway";
import { type Caller, getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/;

/** True when the build's app talks to AI through the orchestrator (component #001). */
function usesAi(metrics: Record<string, unknown>): boolean {
  const comps = (metrics.components as unknown[] | undefined) ?? [];
  return comps.some(
    (c) => (typeof c === "string" ? c : (c as { id?: string } | null)?.id) === "ai.orchestrator.turbineh",
  );
}

type Owned =
  | { ok: false; error: Response }
  | { ok: true; caller: Caller; build: BuildRow };

async function ownedAiBuild(id: string): Promise<Owned> {
  const caller = await getCaller();
  if (!caller) return { ok: false, error: problem(401, "Unauthorized") };
  if (!UUID.test(id)) return { ok: false, error: problem(404, "Build not found") };
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) return { ok: false, error: problem(404, "Build not found") };
  if (!usesAi(build.metrics)) return { ok: false, error: problem(409, "This app does not use AI") };
  return { ok: true, caller, build };
}

/**
 * POST /v1/builds/{id}/ai-token — creates (or rotates) the TurbineH AI gateway token of an AI app (ADR-0029). The
 * token is shown once; the previous one stops working immediately.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const r = await ownedAiBuild(id);
  if (!r.ok) return r.error;
  if (r.build.status !== "done") return problem(409, "Build is not finished");
  const name = String((r.build.spec as { app_name?: string } | null)?.app_name ?? "AI app");
  const t = await createAiAppToken(db, {
    ownerId: r.caller.ownerId,
    buildId: id,
    name,
    ...appTokenDefaults(),
  });
  return Response.json(
    {
      token: t.token,
      prefix: t.prefix,
      url: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/v1/ai`,
      note: "Shown once. Set it as TURBINEH_AI_TOKEN in your app.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

/** GET /v1/builds/{id}/ai-token — token prefix and usage (calls and tokens; never the token, never prices). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const r = await ownedAiBuild(id);
  if (!r.ok) return r.error;
  return Response.json(await aiAppSummary(db, r.caller.ownerId, id), {
    headers: { "Cache-Control": "no-store" },
  });
}

/** DELETE /v1/builds/{id}/ai-token — revokes the token (the app's AI stops until a new one is created). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const r = await ownedAiBuild(id);
  if (!r.ok) return r.error;
  return (await revokeAiAppToken(db, r.caller.ownerId, id))
    ? new Response(null, { status: 204 })
    : problem(404, "No active token");
}
