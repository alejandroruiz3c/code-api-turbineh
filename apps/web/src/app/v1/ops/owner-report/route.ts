import { ownerReportCsv, type ReportView } from "@turbineh/db";
import { buildOwnerReport, reportWindow } from "@/server/owner-report";
import { problem } from "@/server/problem";
import { getStaff } from "@/server/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIEWS: readonly ReportView[] = ["people", "library", "orchestration"];

/**
 * GET /v1/ops/owner-report?since=&until=&days=&format=json|csv&view=people|library|orchestration — the owner usage
 * report across products (ADR-0061): per account for the YES IF library and Intelligence Orchestration, the combined
 * per-person view, totals and the last 7 days vs the 7 before. CSV returns one view (default `people`). TurbineH staff
 * only; 404 for everyone else.
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await getStaff())) return problem(404, "Not found");
  const params = new URL(req.url).searchParams;
  const report = await buildOwnerReport(reportWindow(params));
  if (params.get("format") === "csv") {
    const view = (VIEWS as readonly string[]).includes(params.get("view") ?? "")
      ? (params.get("view") as ReportView)
      : "people";
    return new Response(ownerReportCsv(report, view), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="turbineh-${view}-${report.window.until.slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
