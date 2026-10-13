import { randomBytes } from "node:crypto";
import { recordIntegration } from "@turbineh/db";
import { ERRORS, productError } from "@turbineh/engine";
import { z } from "zod";
import { db } from "@/server/db";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";

const Body = z.object({
  state: z.enum(["integrated", "integration_verified", "reverted", "integration_failed"]),
  integration_id: z
    .string()
    .regex(/^in_[A-Za-z0-9_-]{6,40}$/)
    .optional(),
  where: z.enum(["local", "github"]).default("local"),
  branch: z.string().max(200).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  pull_request: z.url().max(300).optional(),
  checks: z
    .array(
      z.object({
        name: z.string().max(80),
        ok: z.boolean(),
        detail: z.string().max(500).optional(),
      }),
    )
    .max(30)
    .optional(),
});

/**
 * POST /v1/plans/{id}/integrations — the CLI (or the repository integration) reports what happened in the client's
 * project: integrated, integration_verified, reverted or integration_failed. Keeps the activity and states honest.
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
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return productProblem(
      422,
      ERRORS.invalidRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
    );
  const b = parsed.data;
  const record = {
    id: b.integration_id ?? `in_${randomBytes(9).toString("base64url")}`,
    state: b.state,
    at: new Date().toISOString(),
    where: b.where,
    ...(b.branch ? { branch: b.branch } : {}),
    ...(b.commit ? { commit: b.commit } : {}),
    ...(b.pull_request ? { pullRequest: b.pull_request } : {}),
    ...(b.checks ? { checks: b.checks } : {}),
  };
  if (!(await recordIntegration(db, id, caller.ownerId, record))) {
    return productProblem(
      409,
      productError(
        "not_generated",
        "Only a generated package can be integrated.",
        `Generate it first: turbineh apply ${id}`,
      ),
    );
  }
  return Response.json({ integration: record }, { status: 201 });
}
