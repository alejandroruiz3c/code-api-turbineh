import { opsSnapshot } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { isOps } from "@/server/ops";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/** GET /v1/ops — internal operations snapshot (TurbineH staff only; 404 for everyone else). */
export async function GET(): Promise<Response> {
  if (!isOps(await getCaller())) return problem(404, "Not found");
  return Response.json(await opsSnapshot(db), { headers: { "Cache-Control": "no-store" } });
}
