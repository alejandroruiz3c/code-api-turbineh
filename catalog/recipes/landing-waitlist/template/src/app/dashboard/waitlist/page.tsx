import { count, desc } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { waitlistEntries } from "@/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { requireAdmin } from "@/server/admin";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function WaitlistAdmin({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select()
      .from(waitlistEntries)
      .orderBy(desc(waitlistEntries.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(waitlistEntries),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card title={`Waitlist (${total})`}>
      <Table head={["Name", "Email", "Joined"]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-100">
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2">{r.email}</td>
            <td className="px-3 py-2">{r.createdAt.toISOString().slice(0, 10)}</td>
          </tr>
        ))}
      </Table>
      <nav aria-label="Pagination" className="mt-4 flex gap-3 text-sm">
        {page > 1 ? <Link href={`/dashboard/waitlist?page=${page - 1}`}>Previous</Link> : null}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? <Link href={`/dashboard/waitlist?page=${page + 1}`}>Next</Link> : null}
      </nav>
    </Card>
  );
}
