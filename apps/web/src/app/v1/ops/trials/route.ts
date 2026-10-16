import { listOrchestrationTrials } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { isOps } from "@/server/ops";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /v1/ops/trials?limit=100 — Intelligence Orchestration trial accounts (ADR-0059), newest first: email, name,
 * company, use case, signups, spend and the active token prefix. TurbineH staff only; 404 for everyone else.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isOps(await getCaller())) return problem(404, "Not found");
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  const rows = await listOrchestrationTrials(db, Number.isFinite(limit) ? limit : 100);
  return Response.json({ trials: rows }, { headers: { "Cache-Control": "no-store" } });
}
