import { randomBytes } from "node:crypto";
import {
  enqueueRepoIntegration,
  githubConnection,
  listRepoIntegrations,
  type RepoIntegrationRow,
} from "@turbineh/db";
import { BRANCH_NAME, ERRORS, productError, REPO_NAME } from "@turbineh/engine";
import { z } from "zod";
import { db } from "@/server/db";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

const Body = z.object({
  repo: z.string().regex(REPO_NAME, "Use the form owner/name").optional(),
  base: z.string().regex(BRANCH_NAME, "Invalid base branch").optional(),
});

/** Public view of an integration job (no internals, never a token). */
export function integrationView(r: RepoIntegrationRow) {
  return {
    id: r.id,
    repo: r.repo,
    status: r.status,
    phase: r.phase,
    state: r.state,
    branch: r.branch,
    pull_request: r.pr_url ? { url: r.pr_url, number: r.pr_number, draft: r.draft } : null,
    result: r.result,
    error: r.error,
    created_at: r.created_at,
    finished_at: r.finished_at,
  };
}

/**
 * POST /v1/plans/{id}/pull-request — integrate the generated package into a repository of the connected GitHub
 * account: analyse the project, adapt the package to its conventions, commit step by step on `turbineh/<capability>`,
 * open a draft pull request, verify inside the project in the sandbox and mark it ready only when every check
 * passes (state `integration_verified`). Runs in the background: poll GET for progress. Nothing is ever merged.
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
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
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
        `turbineh apply ${id} --pr`,
      ),
    );
  const planRepo = (row.options.repo as { fullName?: string } | undefined)?.fullName;
  const repo = parsed.data.repo ?? planRepo;
  if (!repo)
    return productProblem(
      422,
      productError(
        "repo_required",
        "Which repository should receive the pull request?",
        'Send { "repo": "owner/name" } (or plan with a connected repository).',
      ),
    );
  const conn = await githubConnection(db, caller.ownerId);
  if (!conn)
    return productProblem(
      409,
      productError(
        "github_not_connected",
        "GitHub is not connected for this workspace.",
        "Connect GitHub first (product area: Connect GitHub; CLI: `turbineh connect github`), then try again.",
        `turbineh connect github && turbineh apply ${id} --pr --repo ${repo}`,
      ),
    );
  const { row: job, created } = await enqueueRepoIntegration(db, {
    id: `in_${randomBytes(9).toString("base64url")}`,
    buildId: id,
    ownerId: caller.ownerId,
    repo,
    base: parsed.data.base ?? null,
  });
  return Response.json(
    {
      integration: integrationView(job),
      created,
      status_url: `/v1/plans/${id}/pull-request`,
      next: "Poll the status: analysing → adapting → committing → verifying → done. The pull request stays a draft until the checks pass in your project.",
    },
    { status: created ? 202 : 200, headers: { "Cache-Control": "no-store" } },
  );
}

/** GET /v1/plans/{id}/pull-request — repository integrations of this flow, newest first, with live progress. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const row = await ownedFlow(caller, id);
  if (row instanceof Response) return row;
  const list = await listRepoIntegrations(db, id, caller.ownerId);
  return Response.json(
    { integrations: list.map(integrationView) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
