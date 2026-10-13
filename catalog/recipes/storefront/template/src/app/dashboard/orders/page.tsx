import { count, desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { orderItems, orders } from "@/db/schema";
import { countryName } from "@/lib/countries";
import { formatPrice, orderSummary } from "@/lib/shop";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { requireAdmin } from "@/server/admin";
import { setOrderStatus } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Orders({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(orders),
  ]);
  const items =
    rows.length > 0
      ? await db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((o) => o.id),
            ),
          )
      : [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card title={`Orders (${total})`}>
      <Table head={["Date", "Customer", "Total", "Status", ""]}>
        {rows.map((o) => (
          <tr
            key={o.id}
            data-order-id={o.id}
            data-status={o.status}
            className="border-b border-line"
          >
            <td className="px-3 py-2">
              {o.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </td>
            <td className="px-3 py-2">{o.email ?? "—"}</td>
            <td className="px-3 py-2">
              <details>
                <summary className="cursor-pointer">
                  {formatPrice(o.totalCents, o.currency)}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted">
                  {orderSummary(
                    o,
                    items.filter((i) => i.orderId === o.id),
                  )}
                  {o.country ? `\nShip to: ${countryName(o.country)}` : ""}
                </pre>
              </details>
            </td>
            <td className="px-3 py-2">{o.status}</td>
            <td className="px-3 py-2 text-right">
              {o.status === "paid" || o.status === "pending" ? (
                <form action={setOrderStatus}>
                  <input type="hidden" name="id" value={o.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={o.status === "paid" ? "fulfilled" : "cancelled"}
                  />
                  <button className="text-sm underline" type="submit">
                    {o.status === "paid" ? "Mark fulfilled" : "Cancel"}
                  </button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      <nav aria-label="Pagination" className="mt-4 flex gap-3 text-sm">
        {page > 1 ? <Link href={`/dashboard/orders?page=${page - 1}`}>Previous</Link> : null}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? <Link href={`/dashboard/orders?page=${page + 1}`}>Next</Link> : null}
      </nav>
    </Card>
  );
}
