import { exchangeVercelCode } from "@turbineh/deployer";
import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { seal, vercelRedirectUri, vercelSignInEnabled } from "@/server/deploy-connections";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /deploy/vercel/callback — finishes "Connect Vercel": checks state (server row + cookie + same user), exchanges
 * the one-time code server-side and keeps the token encrypted for 30 minutes. Never echoes Vercel responses.
 */
export async function GET(req: Request): Promise<Response> {
  if (!vercelSignInEnabled()) return problem(404, "Sign-in not available");
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const jar = await cookies();
  const cookieState = jar.get("tbh_deploy_state")?.value;
  jar.delete({ name: "tbh_deploy_state", path: "/deploy" });
  const caller = await getCaller();
  if (!caller || caller.kind === "api-key")
    return problem(401, "Open the product with your access first");
  if (!state || state !== cookieState)
    return problem(400, "This sign-in link is not valid any more");

  const row = (
    await db.query<{ build_id: string }>(
      `SELECT build_id FROM deploy_connections
       WHERE state = $1 AND owner_id = $2 AND provider = 'vercel' AND token_enc IS NULL AND expires_at > now()`,
      [state, caller.ownerId],
    )
  ).rows[0];
  if (!row) return problem(400, "This sign-in link is not valid any more");
  const back = (status: string) =>
    Response.redirect(new URL(`/build/${row.build_id}?deploy=${status}`, env.BETTER_AUTH_URL), 302);
  if (!code) {
    await db.query("DELETE FROM deploy_connections WHERE state = $1", [state]);
    return back("cancelled");
  }
  try {
    const r = await exchangeVercelCode({
      clientId: env.VERCEL_INTEGRATION_CLIENT_ID ?? "",
      clientSecret: env.VERCEL_INTEGRATION_CLIENT_SECRET ?? "",
      code,
      redirectUri: vercelRedirectUri(),
    });
    await db.query(
      "UPDATE deploy_connections SET token_enc = $2, team_id = $3, label = $4 WHERE state = $1",
      [state, seal(r.token), r.teamId, r.teamId ? "Vercel team" : "Vercel personal account"],
    );
    return back("connected");
  } catch {
    await db.query("DELETE FROM deploy_connections WHERE state = $1", [state]);
    return back("error");
  }
}
