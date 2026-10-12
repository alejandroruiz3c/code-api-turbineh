import { getBuild } from "@turbineh/db";
import { neonAuthorizeUrl, pkce, randomState, vercelInstallUrl } from "@turbineh/deployer";
import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { type Provider, providerEnabled, redirectUri, seal } from "@/server/deploy-connections";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/;

/**
 * GET /deploy/{vercel|neon}/connect?build={id} — starts the sign-in for "Deploy for me" (ADR-0021). Browser session
 * only. State is random, stored server-side bound to this user and build, and mirrored in an httpOnly cookie so the
 * callback only completes in the browser that started it.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  if (provider !== "vercel" && provider !== "neon") return problem(404, "Not found");
  const p: Provider = provider;
  if (!providerEnabled(p)) return problem(404, "Sign-in not available");
  const caller = await getCaller();
  if (caller?.kind !== "session") return problem(401, "Sign in first");
  const buildId = new URL(req.url).searchParams.get("build") ?? "";
  if (!UUID.test(buildId)) return problem(422, "Invalid build");
  const build = await getBuild(db, buildId, caller.ownerId);
  if (build?.status !== "done") return problem(404, "Build not found");

  const state = randomState();
  const verifier = p === "neon" ? pkce() : null;
  await db.query(
    "INSERT INTO deploy_connections (state, owner_id, build_id, provider, verifier_enc) VALUES ($1, $2, $3, $4, $5)",
    [state, caller.ownerId, buildId, p, verifier ? seal(verifier.verifier) : null],
  );
  (await cookies()).set("tbh_deploy_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/deploy",
    maxAge: 1800,
  });
  const target =
    p === "vercel"
      ? vercelInstallUrl(env.VERCEL_INTEGRATION_SLUG ?? "", state)
      : neonAuthorizeUrl({
          clientId: env.NEON_OAUTH_CLIENT_ID ?? "",
          redirectUri: redirectUri("neon"),
          state,
          challenge: verifier?.challenge ?? "",
        });
  return Response.redirect(target, 302);
}
