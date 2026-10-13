import { getBuild } from "@turbineh/db";
import { z } from "zod";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { connectionStatus, seal, takeConnection } from "@/server/deploy-connections";
import { problem } from "@/server/problem";

const Body = z
  .object({
    // Either "signed in with Vercel" (ADR-0021) or a pasted token (ADR-0017).
    vercel_connection: z.literal(true).optional(),
    vercel_token: z.string().trim().min(20).max(200).optional(),
    vercel_team_id: z
      .string()
      .trim()
      .regex(/^team_[A-Za-z0-9]+$/)
      .optional(),
    database: z.union([
      z.object({ neon_api_key: z.string().trim().min(20).max(200) }),
      z.object({
        url: z
          .string()
          .trim()
          .regex(/^postgres(ql)?:\/\/\S+$/, "Use a postgres:// connection string")
          .max(1000),
      }),
    ]),
    admin_email: z.email().max(320).optional(),
  })
  .refine((b) => Boolean(b.vercel_connection) !== Boolean(b.vercel_token), {
    message: "Sign in with Vercel or paste a token",
  });

/**
 * POST /v1/builds/{id}/deploy-app — "Deploy for me" (optional, ADR-0017). Deploys the verified build into the
 * client's own Vercel account and database. Credentials are encrypted at rest and erased when the job ends.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) return problem(404, "Build not found");
  if (build.status !== "done") return problem(409, "Build is not finished");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "Invalid request", parsed.error.issues[0]?.message);
  const d = parsed.data;
  // Signed-in tokens are checked first and only then taken (each one serves a single deployment).
  const status = await connectionStatus(caller.ownerId, id);
  if (d.vercel_connection && !status.vercel.connected)
    return problem(409, "Your Vercel sign-in expired", "Connect Vercel again.");
  const vercelConn = d.vercel_connection ? await takeConnection(caller.ownerId, id) : null;
  if (d.vercel_connection && !vercelConn)
    return problem(409, "Your Vercel sign-in expired", "Connect Vercel again.");
  const vercelTokenEnc = vercelConn?.tokenEnc ?? seal(d.vercel_token ?? "");
  const teamId = vercelConn ? vercelConn.teamId : (d.vercel_team_id ?? null);
  const dbMode = "url" in d.database ? "url" : "neon";
  const dbSecretEnc = seal("neon_api_key" in d.database ? d.database.neon_api_key : d.database.url);
  const res = await db.query<{ id: string }>(
    `INSERT INTO deployments (build_id, owner_id, vercel_token_enc, vercel_team_id, db_mode, db_secret_enc, admin_email, vercel_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (build_id) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
    [
      id,
      caller.ownerId,
      vercelTokenEnc,
      teamId,
      dbMode,
      dbSecretEnc,
      d.admin_email ?? null,
      vercelConn ? "integration" : "token",
    ],
  );
  if (!res.rows[0]) return problem(409, "A deployment of this build is already running");
  return Response.json({ deployment_id: res.rows[0].id, status: "queued" }, { status: 202 });
}

/** GET /v1/builds/{id}/deploy-app — latest deployment: status, current step, result (no secrets). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  const res = await db.query(
    "SELECT id, status, step, result, error, created_at, finished_at FROM deployments WHERE build_id = $1 AND owner_id = $2 ORDER BY created_at DESC LIMIT 1",
    [id, caller.ownerId],
  );
  return Response.json({
    deployment: res.rows[0] ?? null,
    connections: await connectionStatus(caller.ownerId, id),
  });
}
