import { sendOwnerReport, weeklyReportDue } from "@turbineh/db";
import { createLogger, mailerFromEnv } from "@turbineh/shared";
import { safeEqual } from "@/server/access-token";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { buildOwnerReport, isProductionHost, ownerReportRecipient } from "@/server/owner-report";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /v1/cron/owner-report — Vercel Cron (apps/web/vercel.json, Mondays 06:00 and 07:00 UTC) sends the weekly owner
 * report (ADR-0061). Vercel calls it with `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the route is 404,
 * with a wrong secret 401. It sends on Monday from 08:00 Europe/Madrid (one of the two runs, summer or winter time),
 * once per ISO week (claimed in owner_report_sends). Outside production (staging) it builds the report but sends
 * nothing, unless OWNER_REPORT_CRON_SEND=1.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = env.CRON_SECRET;
  if (!secret) return problem(404, "Not found");
  const authz = req.headers.get("authorization") ?? "";
  if (!authz.startsWith("Bearer ") || !safeEqual(authz.slice(7).trim(), secret))
    return problem(401, "Unauthorized");
  const now = new Date();
  if (!weeklyReportDue(now) && new URL(req.url).searchParams.get("force") !== "1")
    return Response.json({ status: "not_due" }, { headers: { "Cache-Control": "no-store" } });
  const production = isProductionHost();
  const result = await sendOwnerReport(db, mailerFromEnv(), {
    kind: "weekly",
    to: ownerReportRecipient(),
    now,
    staging: !production,
    dryRun: !production && env.OWNER_REPORT_CRON_SEND !== "1",
    build: () => buildOwnerReport({ until: now }),
    log: createLogger("owner-report"),
  });
  return Response.json(result, {
    status: result.status === "failed" ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
