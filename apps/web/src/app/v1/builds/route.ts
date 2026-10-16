import { buildsLastDay, buildsLastDayFromIp, costToday, enqueueBuild } from "@turbineh/db";
import { z } from "zod";
import { getCaller } from "@/server/caller";
import { requestChannel } from "@/server/channel";
import { clientIpHash } from "@/server/client-ip";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { problem } from "@/server/problem";

const Body = z.object({
  prompt: z.string().trim().min(20, "Describe the app in at least 20 characters").max(20_000),
  github_username: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
  // Optional client brand; re-validated by content (magic bytes) in the worker before use.
  brand: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      font: z.enum(["system", "geometric", "humanist", "rounded", "serif", "mono"]).optional(),
      logo: z
        .string()
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG, JPEG or WebP image")
        .max(360_000, "Logo must be at most 256 KB")
        .optional(),
    })
    .optional(),
  /**
   * ADR-0052: build only the covered part of a partially covered request (explicit choice). Without it such a request
   * is refused like an uncovered one (`use_case_not_covered`, with the requirements not covered).
   */
  covered_only: z.boolean().optional(),
  /**
   * ADR-0062: the use case is not covered but verified components serve part of it — build that components-only
   * package (explicit choice). Without it such a request is refused with `use_case_not_covered` and the offer.
   */
  components_only: z.boolean().optional(),
  // `mode` and `parent` are reserved for POST /v1/builds/{id}/improve.
  options: z
    .record(z.string(), z.unknown())
    .transform((o) =>
      Object.fromEntries(
        Object.entries(o).filter(
          ([k]) => ![
            "mode",
            "parent",
            "brand",
            "covered_only",
            "components_only",
            "contact_email",
            "channel",
          ].includes(k),
        ),
      ),
    )
    .optional(),
});

/** POST /v1/builds — queue a build. Header `Idempotency-Key` makes retries safe. */
export async function POST(req: Request): Promise<Response> {
  const caller = await getCaller();
  if (!caller) return problem(401, "Unauthorized", "Sign in with GitHub or send `Authorization: Bearer <api_key>`.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "Invalid request", parsed.error.issues[0]?.message);
  const quota = caller.kind === "api-key" ? caller.dailyQuota : env.USER_DAILY_BUILDS;
  if ((await buildsLastDay(db, caller.ownerId)) >= quota) {
    return problem(429, "Daily build quota reached", `You can start ${quota} builds per day during the beta.`);
  }
  // Browser sessions also count per client IP (many accounts from one place); API keys have their own quota.
  const ipHash = caller.kind === "api-key" ? null : clientIpHash(req.headers);
  if (ipHash && (await buildsLastDayFromIp(db, ipHash)) >= env.IP_DAILY_BUILDS) {
    return problem(429, "Daily build limit reached for this network", "Please try again tomorrow.");
  }
  if ((await costToday(db)).eur >= env.DAILY_COST_CAP_EUR) {
    return problem(503, "The beta is at capacity", "Today's build capacity is used up. Please come back tomorrow.", { waitlist: true });
  }
  const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 200) || undefined;
  const { id, created } = await enqueueBuild(db, {
    prompt: parsed.data.prompt,
    ownerId: caller.ownerId,
    ...(caller.kind === "api-key" ? { apiKeyId: caller.apiKeyId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(ipHash ? { clientIpHash: ipHash } : {}),
    options: { ...parsed.data.options, ...(parsed.data.github_username ? { github_username: parsed.data.github_username } : {}),
      ...(parsed.data.brand ? { brand: parsed.data.brand } : {}),
      ...(parsed.data.covered_only ? { covered_only: true } : {}),
      ...(parsed.data.components_only ? { components_only: true } : {}),
      ...(caller.kind === "session" ? { contact_email: caller.email } : {}),
      // ADR-0061: web, CLI, MCP or API, for the owner report.
      channel: requestChannel(req.headers),
    },
  });
  return Response.json(
    { build_id: id, created, status_url: `/v1/builds/${id}`, events_url: `/v1/builds/${id}/events` },
    { status: created ? 202 : 200 },
  );
}
