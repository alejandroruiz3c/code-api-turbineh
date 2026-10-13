import {
  buildsLastDay,
  buildsLastDayFromIp,
  costToday,
  enqueueBuild,
  getBuild,
} from "@turbineh/db";
import type { Plan } from "@turbineh/shared";
import {
  detectStack,
  ERRORS,
  MANIFEST_FILES,
  productError,
  projectDependencies,
} from "@turbineh/engine";
import { z } from "zod";
import { clientIpHash } from "@/server/client-ip";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { productProblem, requireCaller, resultOf } from "@/server/product";
import { repoManifests } from "@/server/repo-manifests";

const MANIFESTS = new Set<string>(MANIFEST_FILES);
const PLAN_WAIT_MS = 50_000;

export const maxDuration = 60;

const Body = z.object({
  need: z
    .string()
    .trim()
    .min(8, "Describe the need in a few words (at least 8 characters)")
    .max(4000),
  environment: z
    .object({
      repo: z
        .object({
          provider: z.literal("github"),
          fullName: z.string().max(200),
          ref: z.string().max(200).optional(),
        })
        .optional(),
      files: z.record(z.string().max(200), z.string().max(400_000)).optional(),
      stack: z
        .object({
          language: z.string().max(40),
          framework: z.string().max(40).optional(),
          versions: z.record(z.string().max(60), z.string().max(40)).optional(),
        })
        .optional(),
    })
    .default({}),
  preferences: z.record(z.string(), z.unknown()).optional(),
  /** Only to read a private repository's manifests during this request; never stored. */
  github_token: z.string().max(200).optional(),
  idempotency_key: z.string().max(200).optional(),
});

/**
 * POST /v1/plans — need + environment → plan (PLAN §16.4). The stack is detected here from manifests only; the
 * worker understands the need, selects verified components and returns the plan (state `planning` → `planned`).
 */
export async function POST(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return productProblem(
      422,
      ERRORS.invalidRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
    );
  const { need, environment, preferences, github_token } = parsed.data;

  const quota = caller.kind === "api-key" ? caller.dailyQuota : env.USER_DAILY_BUILDS;
  if ((await buildsLastDay(db, caller.ownerId)) >= quota) {
    return productProblem(
      429,
      productError(
        "quota",
        `Daily limit of ${quota} flows reached.`,
        "Try again tomorrow or ask for a higher limit.",
      ),
    );
  }
  const ipHash = caller.kind === "api-key" ? null : clientIpHash(req.headers);
  if (ipHash && (await buildsLastDayFromIp(db, ipHash)) >= env.IP_DAILY_BUILDS) {
    return productProblem(
      429,
      productError("quota", "Daily limit reached for this network.", "Try again tomorrow."),
    );
  }
  if ((await costToday(db)).eur >= env.DAILY_COST_CAP_EUR) {
    return productProblem(
      503,
      productError("capacity", "Today's capacity is used up.", "Try again tomorrow."),
    );
  }

  let files = Object.fromEntries(
    Object.entries(environment.files ?? {}).filter(([k]) => MANIFESTS.has(k)),
  );
  if (environment.repo) {
    try {
      files = {
        ...(await repoManifests(environment.repo.fullName, environment.repo.ref, github_token)),
        ...files,
      };
    } catch (err) {
      return productProblem(
        422,
        productError(
          "repo_unreadable",
          `Could not read ${environment.repo.fullName}: ${err instanceof Error ? err.message : "unknown error"}.`,
          "Check the name, connect GitHub or pass a token with read access, or upload package.json instead.",
        ),
      );
    }
  }
  const stack = detectStack({
    ...(environment.repo ? { repo: environment.repo } : {}),
    ...(Object.keys(files).length ? { files } : {}),
    ...(environment.stack ? { stack: environment.stack } : {}),
  });
  const idempotencyKey =
    req.headers.get("idempotency-key")?.slice(0, 200) ?? parsed.data.idempotency_key;
  const { id, created } = await enqueueBuild(db, {
    prompt: need,
    ownerId: caller.ownerId,
    ...(caller.kind === "api-key" ? { apiKeyId: caller.apiKeyId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(ipHash ? { clientIpHash: ipHash } : {}),
    options: {
      mode: "plan",
      plan: {
        need,
        stack,
        ...(files["package.json"] ? { projectDependencies: projectDependencies(files) } : {}),
        ...(preferences ? { preferences } : {}),
      },
      ...(environment.repo ? { repo: environment.repo } : {}),
    },
  });
  const links = { status_url: `/v1/plans/${id}`, events_url: `/v1/plans/${id}/events` };
  // Planning takes seconds: wait briefly so most callers get the plan in this response (`?wait=0` returns at once).
  const waitMs = new URL(req.url).searchParams.get("wait") === "0" ? 0 : PLAN_WAIT_MS;
  for (const until = Date.now() + waitMs; Date.now() < until;) {
    await new Promise((r) => setTimeout(r, 1000));
    const row = await getBuild(db, id, caller.ownerId);
    if (row?.status === "failed") {
      const result = await resultOf(row);
      return productProblem(
        422,
        result.errors[0] ?? ERRORS.generationFailed(id, "planning failed"),
      );
    }
    const plan = row?.status === "done" ? (row.metrics.plan as Plan | undefined) : undefined;
    if (plan) return Response.json({ ...plan, id, created, ...links });
  }
  return Response.json(
    {
      id,
      created,
      state: "planning",
      stack,
      status_url: `/v1/plans/${id}`,
      events_url: `/v1/plans/${id}/events`,
    },
    { status: created ? 202 : 200 },
  );
}
