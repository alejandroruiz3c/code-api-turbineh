import { sendOwnerReport } from "@turbineh/db";
import { createLogger, mailerFromEnv } from "@turbineh/shared";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { buildOwnerReport, isProductionHost, ownerReportRecipient } from "@/server/owner-report";
import { problem } from "@/server/problem";
import { getStaff } from "@/server/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /v1/ops/owner-report/send — "send it to me now" (ADR-0061): emails the owner report to OWNER_REPORT_EMAIL right
 * away (not counted as the weekly send). Staff only, 404 otherwise. From the browser (the form on /ops/report) the
 * request must come from this site and answers with a redirect back to the page; API callers get JSON.
 */
export async function POST(req: Request): Promise<Response> {
  const staff = await getStaff();
  if (!staff) return problem(404, "Not found");
  const origin = req.headers.get("origin");
  if (staff.via === "session" && origin && origin !== new URL(env.BETTER_AUTH_URL).origin)
    return problem(403, "Cross-site request refused");
  const result = await sendOwnerReport(db, mailerFromEnv(), {
    kind: "manual",
    to: ownerReportRecipient(),
    staging: !isProductionHost(),
    build: () => buildOwnerReport(),
    log: createLogger("owner-report"),
  });
  const form = (req.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  );
  if (form) {
    const back = new URL("/ops/report", env.BETTER_AUTH_URL);
    back.searchParams.set("sent", result.status);
    return Response.redirect(back.toString(), 303);
  }
  return Response.json(result, { status: result.status === "sent" ? 200 : 502 });
}
