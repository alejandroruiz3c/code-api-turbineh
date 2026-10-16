import { cronRefusal } from "@/social/cron-auth";
import { runDuePosts } from "@/social/posts";

/**
 * GET|POST /api/social/publish/run — publishes the social posts that are due (component social.publish.turbineh).
 * Protected by CRON_SECRET (x-cron-secret or Vercel Cron's Bearer). Call it every minute or few minutes; each post is
 * published at most once, failed attempts are retried with backoff. Answers { published, retrying, failed, unknown }.
 */
async function run(req: Request): Promise<Response> {
  const refused = cronRefusal(req);
  if (refused) return refused;
  return Response.json(await runDuePosts());
}

export const GET = run;
export const POST = run;
export const dynamic = "force-dynamic";
