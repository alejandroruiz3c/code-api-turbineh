import {
  buildsLastDay,
  buildsLastDayFromIp,
  costToday,
  enqueueBuild,
  getBuild,
} from "@turbineh/db";
import { requestChannel } from "@/server/channel";
import type { Plan } from "@turbineh/shared";
import {
  analyseGitHubRepo,
  detectStack,
  ERRORS,
  github,
  GitHubError,
  MANIFEST_FILES,
  productError,
  projectDependencies,
  type RepoAnalysis,
} from "@turbineh/engine";
import { z } from "zod";
import { clientIpHash } from "@/server/client-ip";
import { db } from "@/server/db";
import { confirmDemandLater } from "@/server/demand-email";
import { env } from "@/server/env";
import { catalog, productProblem, requireCaller, resultOf } from "@/server/product";
import { workspaceGitHub } from "@/server/github";
import { planDecider } from "@/server/plan-decider";

const MANIFESTS = new Set<string>(MANIFEST_FILES);
const PLAN_WAIT_MS = 50_000;
const MAX_NEED = 20_000;

export const maxDuration = 60;

const Body = z.object({
  need: z
    .string()
    .trim()
    .min(8, "Describe the need in a few words (at least 8 characters)")
    // A full specification file is accepted (ADR-0036): every criterion it states is compiled and reported.
    .max(
      MAX_NEED,
      `The specification is longer than ${MAX_NEED} characters: keep the parts that state behaviour`,
    ),
  environment: z
    .object({
      repo: z
        .object({
          provider: z.literal("github"),
          fullName: z.string().max(200),
          ref: z.string().max(200).optional(),
          /** Application folder in a monorepo (detected when omitted). */
          appPath: z.string().max(200).optional(),
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
  /** Without a GitHub connection: reads a private repository during this request only; never stored. */
  github_token: z.string().max(200).optional(),
  idempotency_key: z.string().max(200).optional(),
  /**
   * Continue into generation as soon as the plan is ready when it needs no decision from a person (`turbineh build`,
   * ADR-0036): saves a request and a queue round trip. Plans that need approval stop at `planned` as usual.
   */
  generate: z.boolean().optional(),
  /**
   * Verified component ids chosen explicitly (ADR-0052, from /v1/components or `turbineh search`): exactly these are
   * planned, each as it was verified. Without them the need must map to a covered use case or it is refused with
   * `use_case_not_covered`.
   */
  components: z.array(z.string().max(120)).max(20).optional(),
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
  const components = [...new Set(parsed.data.components ?? [])];
  if (components.length > 0) {
    const approved = new Set((await catalog()).map((c) => c.id));
    const unknown = components.filter((id) => !approved.has(id));
    if (unknown.length > 0)
      return productProblem(
        422,
        productError(
          "unknown_component",
          `Not a verified component: ${unknown.join(", ")}.`,
          "Use ids from /v1/components or `turbineh search`.",
        ),
      );
  }

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
  let analysis: RepoAnalysis | undefined;
  if (environment.repo) {
    // The connected account reads the repository (or a one-request token, or anonymously for public ones).
    const ws = await workspaceGitHub(caller.ownerId);
    const gh = !ws.connected && github_token ? github(github_token) : ws.gh;
    try {
      const r = await analyseGitHubRepo(gh, environment.repo.fullName, {
        ...(environment.repo.ref ? { ref: environment.repo.ref } : {}),
        ...(environment.repo.appPath !== undefined ? { appPath: environment.repo.appPath } : {}),
        // Which app of a monorepo receives the capability: the decider, heuristic fallback (ADR-0039).
        decider: planDecider(),
        need,
      });
      analysis = r.analysis;
      // Stack detection reads the application's own manifests (the app folder in a monorepo).
      const at = (f: string) => (r.analysis.appPath ? `${r.analysis.appPath}/${f}` : f);
      files = {
        ...Object.fromEntries(
          MANIFEST_FILES.map((f) => [f, r.files[at(f)] ?? r.files[f]]).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        ),
        ...files,
      };
    } catch (err) {
      return productProblem(
        err instanceof GitHubError && err.status === 401 ? 401 : 422,
        productError(
          "repo_unreadable",
          `Could not read ${environment.repo.fullName}: ${err instanceof Error ? err.message : "unknown error"}`,
          ws.connected
            ? err instanceof GitHubError
              ? err.action
              : "Try again in a moment."
            : "Connect GitHub (with private access for a private repository), or upload package.json instead.",
          "turbineh connect github",
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
        ...(analysis ? { analysis } : {}),
        ...(components.length ? { components } : {}),
      },
      ...(environment.repo ? { repo: environment.repo } : {}),
      ...(parsed.data.generate ? { autoGenerate: true } : {}),
      // ADR-0052: an uncovered request is recorded as demand; signed-in people get the priority notice by email.
      ...(caller.kind === "session" ? { contact_email: caller.email } : {}),
      // ADR-0061: web, CLI, MCP or API, for the owner report.
      channel: requestChannel(req.headers),
    },
  });
  const links = { status_url: `/v1/plans/${id}`, events_url: `/v1/plans/${id}/events` };
  // Planning takes seconds: wait briefly so most callers get the plan in this response (`?wait=0` returns at once).
  const waitMs = new URL(req.url).searchParams.get("wait") === "0" ? 0 : PLAN_WAIT_MS;
  for (const until = Date.now() + waitMs; Date.now() < until;) {
    await new Promise((r) => setTimeout(r, 1000));
    const row = await getBuild(db, id, caller.ownerId);
    // ADR-0056: a refused request gets its priority-list email after this response.
    if (row && (row.status === "failed" || row.status === "done")) confirmDemandLater(row);
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
