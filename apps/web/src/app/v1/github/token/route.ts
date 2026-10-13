import { saveGithubConnection } from "@turbineh/db";
import { productError } from "@turbineh/engine";
import { encrypt } from "@turbineh/shared";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { whoAmI } from "@/server/github-oauth";
import { productProblem, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().trim().min(20).max(400) });

/**
 * POST /v1/github/token — connect with a token you already have (agents, CI, `turbineh connect github
 * --with-token`). It is checked against GitHub once, then stored encrypted like an OAuth connection. Prefer a
 * fine-grained token limited to the repositories to integrate (contents + pull requests: read and write).
 */
export async function POST(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return productProblem(
      422,
      productError("invalid_request", 'Send { "token": "…" }.', "Pass a GitHub token in the body."),
    );
  const user = await whoAmI(fetch, parsed.data.token);
  if (!user)
    return productProblem(
      401,
      productError(
        "github_token_rejected",
        "GitHub did not accept the token.",
        "Create a token with contents and pull requests (read and write) on the repositories to integrate.",
      ),
    );
  const scopes = user.scopes;
  // Classic tokens list scopes; fine-grained tokens list none and are limited per repository by design.
  const privateRepos = scopes ? scopes.split(/[ ,]+/).includes("repo") : true;
  await saveGithubConnection(db, {
    ownerId: caller.ownerId,
    tokenEnc: encrypt(parsed.data.token, env.DELIVERY_TOKEN_KEY),
    login: user.login,
    scopes,
    privateRepos,
    via: "token",
  });
  return Response.json(
    { connected: true, login: user.login, private_repos: privateRepos, via: "token" },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
