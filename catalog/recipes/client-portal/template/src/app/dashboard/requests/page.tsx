import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { requests } from "@/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { requireMember } from "@/server/authz";
import { isStatus, seesAll, STATUS_LABEL } from "@/server/portal";
import { createRequest } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Client requests: list (clients see their own, staff see all) and submit with file uploads. */
export default async function RequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const where = and(
    eq(requests.organizationId, ctx.organizationId),
    seesAll(ctx.role) ? undefined : eq(requests.createdBy, ctx.userId),
  );
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select()
      .from(requests)
      .where(where)
      .orderBy(desc(requests.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(requests).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Requests</h1>
      <Card title="New request">
        <form action={createRequest} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="rq-title">Title</Label>
            <Input id="rq-title" name="title" required minLength={3} maxLength={160} />
          </div>
          <div>
            <Label htmlFor="rq-description">Description</Label>
            <textarea
              id="rq-description"
              name="description"
              required
              maxLength={5000}
              rows={4}
              className="w-full rounded-md border border-field px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Button type="submit">Submit request</Button>
          </div>
        </form>
      </Card>
      <Card title={seesAll(ctx.role) ? "All requests" : "Your requests"}>
        <Table head={["Title", "Status", "Updated"]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="px-3 py-2">
                <Link className="underline" href={`/dashboard/requests/${r.id}`}>
                  {r.title}
                </Link>
              </td>
              <td className="px-3 py-2">
                {isStatus(r.status) ? STATUS_LABEL[r.status] : r.status}
              </td>
              <td className="px-3 py-2">{r.updatedAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </Table>
        <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? <Link href={`/dashboard/requests?page=${page - 1}`}>Previous</Link> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={`/dashboard/requests?page=${page + 1}`}>Next</Link> : null}
        </nav>
      </Card>
    </div>
  );
}
