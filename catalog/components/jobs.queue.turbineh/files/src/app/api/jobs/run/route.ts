import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runDueJobs } from "@/lib/jobs";

const secret = z
  .string()
  .min(32)
  .optional()
  .parse(process.env.JOBS_RUNNER_SECRET || process.env.CRON_SECRET || undefined);

function authorized(req: Request): boolean {
  if (!secret) return false;
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(req: Request): Promise<Response> {
  if (!secret) return Response.json({ error: "Job runner is not configured" }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runDueJobs(10));
}

/** POST /api/jobs/run — any scheduler, with `Authorization: Bearer <JOBS_RUNNER_SECRET>`. */
export const POST = run;
/** GET /api/jobs/run — Vercel Cron (sends `Authorization: Bearer <CRON_SECRET>`). */
export const GET = run;
