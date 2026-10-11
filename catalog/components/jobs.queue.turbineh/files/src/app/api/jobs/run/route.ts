import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runDueJobs } from "@/lib/jobs";

const secret = z
  .string()
  .min(32)
  .optional()
  .parse(process.env.JOBS_RUNNER_SECRET || undefined);

/** POST /api/jobs/run — called by a scheduler (cron) with `Authorization: Bearer <JOBS_RUNNER_SECRET>`. */
export async function POST(req: Request): Promise<Response> {
  if (!secret) return Response.json({ error: "Job runner is not configured" }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await runDueJobs(10));
}
