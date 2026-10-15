import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runScheduled } from "@/jobs/runner";

/**
 * GET|POST /api/cron/run[?job=<id>] — runs the scheduled jobs that are due (component jobs.scheduled.turbineh).
 * Protected by a shared secret: header `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>` (what
 * Vercel Cron sends). Call it every few minutes from any scheduler; each scheduled occurrence runs at most once.
 */
const secret = z
  .string()
  .min(32)
  .optional()
  .parse(process.env.CRON_SECRET || undefined);

function authorized(req: Request): boolean {
  if (!secret) return false;
  const given = Buffer.from(
    req.headers.get("x-cron-secret") ??
      (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
  );
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(req: Request): Promise<Response> {
  if (!secret)
    return Response.json(
      { error: "Scheduled jobs are not configured (CRON_SECRET)" },
      { status: 503 },
    );
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const job = new URL(req.url).searchParams.get("job");
  if (job !== null && !/^[a-z][a-z0-9-]{0,39}$/.test(job))
    return Response.json({ error: "Unknown job" }, { status: 400 });
  return Response.json(await runScheduled({ jobId: job ?? undefined }));
}

export const GET = run;
export const POST = run;
