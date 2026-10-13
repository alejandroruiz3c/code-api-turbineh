import { getBuild } from "@turbineh/db";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/server/auth";
import { getCaller } from "@/server/caller";
import { encrypt } from "@turbineh/shared";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

const Body = z.object({ repo_name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional() });

/**
 * POST /v1/builds/{id}/deliver — "Push to my GitHub" (channel B). Requires a GitHub session with the `repo`
 * scope; returns 409 `needs_scope` so the UI can ask for it. The push itself is done by a worker with one git push.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller || caller.kind !== "session") return problem(401, "Sign in with GitHub to push to your account");
  const build = await getBuild(db, id, caller.ownerId);
  if (!build || build.status !== "done") return problem(409, "Build is not finished");
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(422, "Invalid repository name");

  const h = await headers();
  const accounts = await auth.api.listUserAccounts({ headers: h }).catch(() => []);
  const github = accounts.find((a) => a.providerId === "github");
  const token = github
    ? await auth.api.getAccessToken({ body: { accountId: github.id }, headers: h }).catch(() => null)
    : null;
  if (!token?.accessToken) return problem(409, "GitHub authorization required", undefined, { needs_scope: "repo" });
  const scopes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token.accessToken}`, "User-Agent": "code-api-turbineh" },
  }).then((r) => (r.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()));
  if (!scopes.includes("repo")) return problem(409, "GitHub `repo` permission required", undefined, { needs_scope: "repo" });

  const slug = (build.artifact as { slug?: string } | null)?.slug ?? "app";
  const res = await db.query<{ id: string }>(
    `INSERT INTO deliveries (build_id, owner_id, channel, repo_name, token_enc)
     VALUES ($1, $2, 'B', $3, $4)
     ON CONFLICT (build_id) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
    [id, caller.ownerId, parsed.data.repo_name ?? slug, encrypt(token.accessToken, env.DELIVERY_TOKEN_KEY)],
  );
  return Response.json({ delivery_id: res.rows[0]?.id ?? null, status: "queued" }, { status: 202 });
}

/** GET /v1/builds/{id}/deliver — latest delivery status for this build. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized");
  const res = await db.query(
    "SELECT id, status, repo_url, error, created_at FROM deliveries WHERE build_id = $1 AND owner_id = $2 ORDER BY created_at DESC LIMIT 1",
    [id, caller.ownerId],
  );
  return Response.json({ delivery: res.rows[0] ?? null });
}
