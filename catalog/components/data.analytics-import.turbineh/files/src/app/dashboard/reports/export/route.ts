import { dataset as ds } from "@/analytics-import/config";
import { parseFilters } from "@/analytics-import/filters";
import { byDimension, lastDay, series } from "@/analytics-import/service";
import { toCsv } from "@/lib/csv";
import { can, requireMember } from "@/server/authz";

/**
 * GET /dashboard/reports/export?chart=series|compare|top-<dimension>&from&to&period&scope — the numbers of one chart
 * as CSV, with the same filters and the same per-scope access as the dashboard.
 */
export async function GET(req: Request): Promise<Response> {
  const ctx = await requireMember();
  if (!ds.exportCsv) return new Response("Not found", { status: 404 });
  // Exporting is a privilege of its own (ADR-0054): roles that may read the dashboard cannot necessarily export.
  if (!can(ctx.role, "export")) return new Response("Forbidden", { status: 403 });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const f = parseFilters(q, await lastDay(ctx));
  const chart = q.chart ?? "series";
  let rows: Record<string, unknown>[];
  let first: string;
  if (chart === "series") {
    first = f.period;
    rows = (await series(ctx, f, f.period)).map((r) => ({ ...r, [f.period]: r.period }));
  } else {
    const dim = chart === "compare" ? ds.scope : chart.replace(/^top-/, "");
    if (!dim || !ds.dimensions.includes(dim)) return new Response("Not found", { status: 404 });
    first = dim;
    rows = (await byDimension(ctx, f, dim, chart === "compare" ? 200 : 10)).map((r) => ({
      ...r,
      [dim]: r.value,
    }));
  }
  const csv = toCsv(rows, [first, ...ds.measures]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${chart.replace(/[^a-z0-9-]/gi, "")}-${f.from}-${f.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
