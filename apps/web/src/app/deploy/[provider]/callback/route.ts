import { exchangeNeonCode, exchangeVercelCode } from "@turbineh/deployer";
import { decrypt } from "@turbineh/shared";
import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { type Provider, providerEnabled, redirectUri, seal } from "@/server/deploy-connections";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /deploy/{vercel|neon}/callback — finishes the sign-in: checks state (server row + cookie + same user), exchanges
 * the one-time code server-side and keeps the token encrypted for 30 minutes. Never echoes provider responses.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  if (provider !== "vercel" && provider !== "neon") return problem(404, "Not found");
  const p: Provider = provider;
  if (!providerEnabled(p)) return problem(404, "Sign-in not available");
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const jar = await cookies();
  const cookieState = jar.get("tbh_deploy_state")?.value;
  jar.delete({ name: "tbh_deploy_state", path: "/deploy" });
  const caller = await getCaller();
  if (caller?.kind !== "session") return problem(401, "Sign in first");
  if (!state || state !== cookieState)
    return problem(400, "This sign-in link is not valid any more");

  const row = (
    await db.query<{ build_id: string; verifier_enc: string | null }>(
      `SELECT build_id, verifier_enc FROM deploy_connections
       WHERE state = $1 AND owner_id = $2 AND provider = $3 AND token_enc IS NULL AND expires_at > now()`,
      [state, caller.ownerId, p],
    )
  ).rows[0];
  if (!row) return problem(400, "This sign-in link is not valid any more");
  const back = (status: string) =>
    Response.redirect(
      new URL(`/build/${row.build_id}?deploy=${status}&provider=${p}`, env.BETTER_AUTH_URL),
      302,
    );
  if (!code) {
    await db.query("DELETE FROM deploy_connections WHERE state = $1", [state]);
    return back("cancelled");
  }
  try {
    if (p === "vercel") {
      const r = await exchangeVercelCode({
        clientId: env.VERCEL_INTEGRATION_CLIENT_ID ?? "",
        clientSecret: env.VERCEL_INTEGRATION_CLIENT_SECRET ?? "",
        code,
        redirectUri: redirectUri("vercel"),
      });
      await db.query(
        "UPDATE deploy_connections SET token_enc = $2, team_id = $3, label = $4, verifier_enc = NULL WHERE state = $1",
        [state, seal(r.token), r.teamId, r.teamId ? "Vercel team" : "Vercel personal account"],
      );
    } else {
      const r = await exchangeNeonCode({
        clientId: env.NEON_OAUTH_CLIENT_ID ?? "",
        clientSecret: env.NEON_OAUTH_CLIENT_SECRET ?? "",
        code,
        redirectUri: redirectUri("neon"),
        verifier: decrypt(row.verifier_enc ?? "", env.DELIVERY_TOKEN_KEY),
      });
      await db.query(
        "UPDATE deploy_connections SET token_enc = $2, label = $3, verifier_enc = NULL WHERE state = $1",
        [state, seal(r.token), "Neon account"],
      );
    }
    return back("connected");
  } catch {
    await db.query("DELETE FROM deploy_connections WHERE state = $1", [state]);
    return back("error");
  }
}
