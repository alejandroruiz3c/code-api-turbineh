import { demandContactStatus, getBuild, setDemandEmail } from "@turbineh/db";
import { z } from "zod";
import { type Caller, getCaller } from "@/server/caller";
import { EMAIL_PURPOSE, EmailField } from "@/server/contact";
import { db } from "@/server/db";
import { confirmDemandNow } from "@/server/demand-email";
import { NOT_JSON, problem, readJson } from "@/server/problem";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;
const Body = z.object({ email: EmailField });
const NO_STORE = { "Cache-Control": "no-store" };

/** The caller, when it owns the flow; otherwise the problem response (401 / 404: never another owner's flow). */
async function ownedId(id: string): Promise<Caller | Response> {
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  if (!UUID.test(id) || !(await getBuild(db, id, caller.ownerId)))
    return problem(404, "Build not found");
  return caller;
}

/**
 * GET /v1/builds/{id}/notify — for a flow the library does not cover (ADR-0052): whether an email is on file for the
 * priority notice and whether the confirmation was sent (ADR-0074). Never the address.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await ownedId(id);
  if (caller instanceof Response) return caller;
  const s = await demandContactStatus(db, id, caller.ownerId);
  return Response.json(
    { demand: s.demand, email_on_file: s.emailOnFile, confirmed: s.confirmed, purpose: EMAIL_PURPOSE },
    { headers: NO_STORE },
  );
}

/**
 * POST /v1/builds/{id}/notify {email} — "Notify me when it's covered" (ADR-0074): adds the email to the flow's demand
 * record and sends the priority-list confirmation (ADR-0056) if it was not sent yet. Only for flows refused by the
 * scope gate (409 otherwise); at most 5 times per flow.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await ownedId(id);
  if (caller instanceof Response) return caller;
  const json = await readJson(req);
  if (json === NOT_JSON) return problem(400, "Invalid JSON", "The request body is not valid JSON.");
  const parsed = Body.safeParse(json);
  if (!parsed.success) return problem(422, "Invalid request", parsed.error.issues[0]?.message);
  const saved = await setDemandEmail(db, id, caller.ownerId, parsed.data.email);
  if (saved.status === "no_demand")
    return problem(
      409,
      "This flow was not refused",
      "Only a request the library does not cover (use_case_not_covered) is followed up by email.",
      { code: "not_uncovered" },
    );
  if (saved.status === "rate_limited")
    return problem(429, "Too many email changes for this flow", "Try again tomorrow.", {
      code: "rate_limited",
    });
  const confirmation = saved.confirmationPending ? confirmDemandNow(id) : "already_sent";
  return Response.json(
    { demand: true, email_on_file: true, confirmation },
    { headers: NO_STORE },
  );
}
