import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { bookings } from "@/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { can, requireMember } from "@/server/authz";
import { cancelBooking } from "./actions";
import { BookingForm } from "./form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Bookings list and the form to book a slot. */
export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const where = eq(bookings.organizationId, ctx.organizationId);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select()
      .from(bookings)
      .where(where)
      .orderBy(desc(bookings.startsAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(bookings).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Bookings</h1>
      <Card title="New booking">
        <BookingForm />
      </Card>
      <Card title="All bookings">
        <Table head={["Customer", "Email", "Starts", "Ends", "Status", ""]}>
          {rows.map((b) => (
            <tr key={b.id} className="border-b border-line">
              <td className="px-3 py-2">{b.customerName}</td>
              <td className="px-3 py-2">{b.customerEmail}</td>
              <td className="px-3 py-2">{when(b.startsAt)}</td>
              <td className="px-3 py-2">{when(b.endsAt)}</td>
              <td className="px-3 py-2">{b.status}</td>
              <td className="px-3 py-2 text-right">
                {b.status === "confirmed" &&
                (b.createdBy === ctx.userId || can(ctx.role, "update")) ? (
                  <form action={cancelBooking}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="text-sm text-danger" type="submit">
                      Cancel
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
        <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? <Link href={`/dashboard/bookings?page=${page - 1}`}>Previous</Link> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={`/dashboard/bookings?page=${page + 1}`}>Next</Link> : null}
        </nav>
      </Card>
    </div>
  );
}
