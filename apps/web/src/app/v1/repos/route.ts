import { GitHubError, github, listRepos, productError } from "@turbineh/engine";
import { workspaceToken } from "@/server/github";
import { productProblem, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

/**
 * GET /v1/repos?q=web — repositories the workspace's connected GitHub account can write to (name filter, private or
 * public). Without a connection, an `x-github-token` header is used for this request only (never stored).
 */
export async function GET(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const token =
    (await workspaceToken(caller.ownerId)) ?? req.headers.get("x-github-token")?.trim() ?? null;
  if (!token)
    return productProblem(
      409,
      productError(
        "github_not_connected",
        "GitHub is not connected for this workspace.",
        "Connect GitHub (product area: Connect GitHub; CLI: `turbineh connect github`), or plan from uploaded manifests instead.",
        "turbineh connect github",
      ),
    );
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
  try {
    const repos = await listRepos(github(token), q);
    return Response.json(
      {
        repos: repos.slice(0, 100).map((r) => ({
          full_name: r.fullName,
          private: r.private,
          default_branch: r.defaultBranch,
          description: r.description,
          pushed_at: r.pushedAt,
          // Kept for older clients.
          fullName: r.fullName,
          defaultBranch: r.defaultBranch,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof GitHubError)
      return productProblem(err.status, productError("github", err.message, err.action));
    throw err;
  }
}
