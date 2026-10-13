import { randomBytes } from "node:crypto";
import { recordIntegration } from "@turbineh/db";
import { ERRORS, productError } from "@turbineh/engine";
import { z } from "zod";
import { db } from "@/server/db";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";
import { openPullRequest, REPO_NAME, RepoError } from "@/server/repo-pr";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  repo: z.string().regex(REPO_NAME, "Use the form owner/name"),
  base: z.string().min(1).max(200).optional(),
  github_token: z.string().min(20).max(400),
});

/**
 * POST /v1/plans/{id}/pull-request — deliver the generated package as a pull request on the user's GitHub
 * repository (one commit on a new branch; nothing is merged). The token is used for this request only, never stored.
 * The alternative without GitHub is the ZIP: GET /v1/plans/{id}/package.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const row = await ownedFlow(caller, id);
  if (row instanceof Response) return row;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return productProblem(
      422,
      ERRORS.invalidRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
    );
  const zipKey = (row.artifact?.package as { zipKey?: string } | undefined)?.zipKey;
  if (!zipKey || row.status !== "done")
    return productProblem(
      409,
      productError(
        "package_not_ready",
        "The package is not generated yet.",
        `Generate it first (POST /v1/plans/${id}/generate) and wait for the state \`verified\`.`,
        `turbineh apply ${id}`,
      ),
    );
  try {
    const pr = await openPullRequest({
      repo: parsed.data.repo,
      ...(parsed.data.base ? { base: parsed.data.base } : {}),
      token: parsed.data.github_token,
      zip: await storage.get(zipKey),
      planId: id,
      need: row.prompt,
    });
    const record = {
      id: `in_${randomBytes(9).toString("base64url")}`,
      state: "integrated",
      at: new Date().toISOString(),
      where: "github",
      repo: parsed.data.repo,
      branch: pr.branch,
      commit: pr.commit,
      pullRequest: pr.url,
    };
    await recordIntegration(db, id, caller.ownerId, record);
    return Response.json(
      {
        integration: record,
        pull_request: { url: pr.url, number: pr.number },
        added_dependencies: pr.added,
        settings_to_set: pr.settings,
        next: `Review and merge the pull request yourself; wire it in following turbineh/${pr.slug}/agent/INTEGRATE.md.`,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof RepoError)
      return productProblem(err.status, productError("repo_integration", err.message, err.action));
    throw err;
  }
}
