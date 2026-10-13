import { productError } from "@turbineh/engine";
import { productProblem, requireCaller } from "@/server/product";
import { RepoError, writableRepos } from "@/server/repo-pr";

export const dynamic = "force-dynamic";

/**
 * GET /v1/repos — the GitHub repositories the user can integrate into, with the token in the `x-github-token`
 * header (used for this request only, never stored). Optional: plans also accept uploaded manifests or a stack.
 */
export async function GET(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const token = req.headers.get("x-github-token")?.trim();
  if (!token)
    return productProblem(
      422,
      productError(
        "github_token_required",
        "A GitHub token is needed to list your repositories.",
        "Send it in the x-github-token header, or plan from uploaded manifests instead.",
      ),
    );
  try {
    return Response.json(
      { repos: await writableRepos(token) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof RepoError)
      return productProblem(err.status, productError("github", err.message, err.action));
    throw err;
  }
}
