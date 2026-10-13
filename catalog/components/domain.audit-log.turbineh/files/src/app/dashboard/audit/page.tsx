import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { auditConfig } from "@/audit/config";
import { auditFacets, listAuditEvents, parseFilters } from "@/audit/query";
import { can, requireMember } from "@/server/authz";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Audit log of the workspace (owners only by default): who changed what and when, with filters and CSV export. */
export default async function AuditPage({ searchParams }: Props) {
  const ctx = await requireMember();
  if (!can(ctx.role, "view_audit")) {
    return (
      <Card title="Audit log">
        <p role="alert" className="text-sm text-danger">
          You do not have access to the audit log.
        </p>
      </Card>
    );
  }
  const q = await searchParams;
  const filters = parseFilters(q);
  const n = Number.parseInt((Array.isArray(q.page) ? q.page[0] : q.page) ?? "1", 10);
  const page = Number.isFinite(n) && n > 0 && n < 10_000 ? n : 1;
  const limit = auditConfig.pageSize;
  const [{ rows, total }, facets] = await Promise.all([
    listAuditEvents(ctx.organizationId, filters, { limit, offset: (page - 1) * limit }),
    auditFacets(ctx.organizationId),
  ]);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== "") as [string, string][],
  );
  const pages = Math.max(1, Math.ceil(total / limit));
  const link = (p: number) =>
    `/dashboard/audit?${new URLSearchParams([...query, ["page", String(p)]])}`;
  return (
    <div className="flex flex-col gap-6">
      <Card title="Audit log">
        <p className="mb-4 text-sm text-muted">
          Every change in this workspace, newest first. Entries cannot be edited or deleted.
        </p>
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-6" aria-label="Filters">
          <div>
            <Label htmlFor="audit-actor">Who</Label>
            <Input id="audit-actor" name="actor" defaultValue={filters.actor} placeholder="email" />
          </div>
          <div>
            <Label htmlFor="audit-action">Action</Label>
            <select
              id="audit-action"
              name="action"
              defaultValue={filters.action}
              className="w-full rounded-md border border-field px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="audit-subject">Record type</Label>
            <select
              id="audit-subject"
              name="subject"
              defaultValue={filters.subject}
              className="w-full rounded-md border border-field px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {facets.subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div>
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            <a
              className="rounded-md border border-field px-3 py-2 text-sm"
              href={`/dashboard/audit/export?${query}`}
            >
              Export CSV
            </a>
          </div>
        </form>
      </Card>
      <Card>
        <p className="mb-3 text-sm text-muted" data-testid="audit-total">
          {total} {total === 1 ? "entry" : "entries"}
        </p>
        <Table head={["When (UTC)", "Who", "Action", "Record", "Changes"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top" data-testid="audit-row">
              <td className="px-3 py-2 whitespace-nowrap">
                {r.createdAt.toISOString().slice(0, 19).replace("T", " ")}
              </td>
              <td className="px-3 py-2">{r.actorEmail ?? "system"}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{r.action}</span>
                <div className="text-muted">{r.summary}</div>
              </td>
              <td className="px-3 py-2">
                {r.subjectType}
                {r.subjectId ? <div className="text-xs text-muted">{r.subjectId}</div> : null}
              </td>
              <td className="px-3 py-2">
                {r.changes.length ? (
                  <ul className="text-xs">
                    {r.changes.map((c) => (
                      <li key={c.field}>
                        <span className="font-medium">{c.field}</span>: {c.before ?? "—"} →{" "}
                        {c.after ?? "—"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-4 flex gap-3 text-sm">
            {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : null}
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? <Link href={link(page + 1)}>Next</Link> : null}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
