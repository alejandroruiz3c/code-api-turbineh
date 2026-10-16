import { cronRefusal } from "@/social/cron-auth";
import { runMetrics } from "@/social/metrics";

/**
 * GET|POST /api/social/metrics/run — fetches engagement metrics of recently published social posts (component
 * social.metrics.turbineh). Protected by CRON_SECRET (x-cron-secret or Vercel Cron's Bearer); call it every hour or
 * few hours. Answers { fetched, failed, skipped }.
 */
async function run(req: Request): Promise<Response> {
  const refused = cronRefusal(req);
  if (refused) return refused;
  return Response.json(await runMetrics());
}

export const GET = run;
export const POST = run;
export const dynamic = "force-dynamic";
