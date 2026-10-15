import { getBuild } from "@turbineh/db";
import { randomState, vercelInstallUrl } from "@turbineh/deployer";
import { cookies } from "next/headers";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { vercelSignInEnabled } from "@/server/deploy-connections";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/;

/**
 * GET /deploy/vercel/connect?build={id} — starts "Connect Vercel" for Deploy for me (ADR-0021). Browser session
 * only. State is random, stored server-side bound to this user and build, and mirrored in an httpOnly cookie so the
 * callback only completes in the browser that started it.
 */
export async function GET(req: Request): Promise<Response> {
  if (!vercelSignInEnabled()) return problem(404, "Sign-in not available");
  const caller = await getCaller();
  if (!caller || caller.kind === "api-key")
    return problem(401, "Open the product with your access first");
  const buildId = new URL(req.url).searchParams.get("build") ?? "";
  if (!UUID.test(buildId)) return problem(422, "Invalid build");
  const build = await getBuild(db, buildId, caller.ownerId);
  if (build?.status !== "done") return problem(404, "Build not found");

  const state = randomState();
  await db.query(
    "INSERT INTO deploy_connections (state, owner_id, build_id, provider) VALUES ($1, $2, $3, 'vercel')",
    [state, caller.ownerId, buildId],
  );
  (await cookies()).set("tbh_deploy_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/deploy",
    maxAge: 1800,
  });
  return Response.redirect(vercelInstallUrl(env.VERCEL_INTEGRATION_SLUG ?? "", state), 302);
}
