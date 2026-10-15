import { and, asc, between, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataPoints, datasets } from "@/db/schema";
import { EXPORT_MAX_ROWS, exportTooLarge, toCsv } from "@/lib/csv";
import { can, requireMember } from "@/server/authz";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** CSV export of the filtered data (formula-injection safe). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const member = await requireMember();
  // Exporting is a privilege of its own (ADR-0054): roles that may read cannot necessarily export.
  if (!can(member.role, "export")) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, id), eq(datasets.organizationId, member.organizationId)));
  if (!ds) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const from = ISO.test(q.get("from") ?? "") ? (q.get("from") as string) : "1900-01-01";
  const to = ISO.test(q.get("to") ?? "") ? (q.get("to") as string) : "2999-12-31";
  const category = (q.get("category") ?? "").slice(0, 80);
  const rows = await db
    .select({ date: dataPoints.day, category: dataPoints.category, value: dataPoints.value })
    .from(dataPoints)
    .where(
      and(
        eq(dataPoints.datasetId, ds.id),
        between(dataPoints.day, from, to),
        category ? eq(dataPoints.category, category) : undefined,
      ),
    )
    .orderBy(asc(dataPoints.day))
    .limit(EXPORT_MAX_ROWS + 1);
  // Never silently truncated (ADR-0054): over the limit the export is refused with a message.
  if (rows.length > EXPORT_MAX_ROWS) return exportTooLarge();
  return new Response(toCsv(rows, ["date", "category", "value"]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dataset-${ds.id}.csv"`,
    },
  });
}
