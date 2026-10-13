import {
  analyseGitHubRepo,
  analysisFindings,
  GitHubError,
  productError,
  REPO_NAME,
} from "@turbineh/engine";
import { workspaceGitHub } from "@/server/github";
import { productProblem, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /v1/repos/{owner}/{name}/analysis?ref=main — what the project is made of and how it is written (stack,
 * conventions, database and auth layers, tests, CI, env file names) plus the general conflicts for TurbineH
 * capabilities. Read through the GitHub API: configuration files only, never env files' contents, nothing cloned.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ owner: string; name: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { owner, name } = await ctx.params;
  const fullName = `${owner}/${name}`;
  if (!REPO_NAME.test(fullName))
    return productProblem(
      422,
      productError("invalid_request", "Invalid repository name.", "Use owner/name."),
    );
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref")?.slice(0, 200) || undefined;
  const appPath = url.searchParams.get("app")?.slice(0, 200) ?? undefined;
  const { gh, connected } = await workspaceGitHub(caller.ownerId);
  try {
    const { analysis, info } = await analyseGitHubRepo(gh, fullName, {
      ...(ref ? { ref } : {}),
      ...(appPath !== undefined ? { appPath } : {}),
    });
    const general = analysisFindings(analysis, {
      kind: "component",
      slug: "capability",
      usesDatabase: true,
      usesAuth: false,
      dependencies: {},
    });
    return Response.json(
      {
        repo: info.fullName,
        private: info.private,
        can_push: info.canPush,
        default_branch: info.defaultBranch,
        analysis,
        conflicts: general.conflicts,
        decisions: general.decisions.filter((d) => d.topic !== "placement"),
        compatible: general.compatible,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof GitHubError)
      return productProblem(
        err.status,
        productError(
          "repo_unreadable",
          err.message,
          connected
            ? err.action
            : "Connect GitHub (with private access for a private repository) and try again.",
        ),
      );
    throw err;
  }
}
