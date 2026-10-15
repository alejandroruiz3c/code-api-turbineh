import { listDemand } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { isOps } from "@/server/ops";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /v1/ops/demand?limit=100 — requests the library does not cover yet (ADR-0052), newest first: who asked (account
 * or workspace, email when known), the request, the missing requirements and whether they are subscribed to the
 * priority notification. TurbineH staff only; 404 for everyone else.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isOps(await getCaller())) return problem(404, "Not found");
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  const rows = await listDemand(db, Number.isFinite(limit) ? limit : 100);
  return Response.json({ demand: rows }, { headers: { "Cache-Control": "no-store" } });
}
