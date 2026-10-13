import { deleteGithubConnection, githubConnection } from "@turbineh/db";
import { decrypt } from "@turbineh/shared";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { connectionView, revokeGrant } from "@/server/github-oauth";
import { requireCaller, githubWorkspaceProblem } from "@/server/product";

export const dynamic = "force-dynamic";

/** GET /v1/github — this workspace's GitHub connection (account, private access, scopes). Never the token. */
export async function GET(): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const gate = githubWorkspaceProblem(caller);
  if (gate) return gate;
  return Response.json(
    {
      ...connectionView(await githubConnection(db, caller.ownerId)),
      connect: {
        browser: "/api/github/connect?return=/flows/new",
        browser_private: "/api/github/connect?private=1&return=/flows/new",
        cli: "POST /v1/github/connect",
        token: "POST /v1/github/token",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** DELETE /v1/github — Disconnect GitHub: deletes the stored token and revokes the authorization at GitHub. */
export async function DELETE(): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const gate = githubWorkspaceProblem(caller);
  if (gate) return gate;
  const gone = await deleteGithubConnection(db, caller.ownerId);
  let revoked = false;
  if (gone?.via === "oauth") {
    try {
      revoked = await revokeGrant(
        fetch,
        env.GITHUB_CLIENT_ID,
        env.GITHUB_CLIENT_SECRET,
        decrypt(gone.tokenEnc, env.DELIVERY_TOKEN_KEY),
      );
    } catch {
      revoked = false;
    }
  }
  return Response.json(
    {
      connected: false,
      removed: Boolean(gone),
      revoked_at_github: revoked,
      note:
        gone?.via === "token"
          ? "The token you provided was deleted here; revoke it in GitHub settings if you no longer need it."
          : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
