import { getBuild } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { confirmDemandLater } from "@/server/demand-email";
import { buildResponse } from "@/server/flow-response";
import { problem } from "@/server/problem";

const UUID = /^[0-9a-f-]{36}$/;

/** GET /v1/builds/{id} — status, metrics, artefact links, repository URL and feedback. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (!UUID.test(id)) return problem(404, "Build not found");
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) return problem(404, "Build not found");
  // ADR-0056: a refused request gets its priority-list email after this response.
  confirmDemandLater(build);
  return Response.json(await buildResponse(build, caller));
}
