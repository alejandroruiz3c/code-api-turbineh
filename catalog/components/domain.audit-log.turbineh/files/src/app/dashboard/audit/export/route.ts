import { auditConfig } from "@/audit/config";
import { exportAuditEvents, parseFilters } from "@/audit/query";
import { audit } from "@/lib/audit";
import { exportTooLarge, toCsv } from "@/lib/csv";
import { can, requireMember } from "@/server/authz";

/** CSV export of the filtered audit log (same access as the page); the export itself is recorded in the log. */
export async function GET(req: Request): Promise<Response> {
  const ctx = await requireMember();
  if (!can(ctx.role, "view_audit")) return new Response("Not found", { status: 404 });
  const filters = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  // Never silently truncated (ADR-0054): over the limit the export is refused with a message to narrow the filters.
  const rows = await exportAuditEvents(ctx.organizationId, filters, auditConfig.exportLimit + 1);
  if (rows.length > auditConfig.exportLimit) return exportTooLarge(auditConfig.exportLimit);
  await audit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "audit.exported",
    subjectType: "Audit log",
    summary: `Exported ${rows.length} audit entries as CSV`,
  });
  const csv = toCsv(
    rows.map((r) => ({
      when: r.createdAt.toISOString(),
      who: r.actorEmail ?? "system",
      action: r.action,
      record: r.subjectType,
      recordId: r.subjectId ?? "",
      summary: r.summary,
      changes: r.changes.map((c) => `${c.field}: ${c.before ?? ""} -> ${c.after ?? ""}`).join("; "),
    })),
    ["when", "who", "action", "record", "recordId", "summary", "changes"],
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
      "Cache-Control": "no-store",
    },
  });
}
