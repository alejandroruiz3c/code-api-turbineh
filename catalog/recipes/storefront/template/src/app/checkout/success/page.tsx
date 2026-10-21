import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ShopShell } from "@/components/shop-shell";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { formatPrice } from "@/lib/shop";

export const metadata: Metadata = { title: "Thank you — __APP_NAME__", robots: { index: false } };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ order?: string; session_id?: string }>;

/**
 * The order this return belongs to: both the order id and the Stripe Checkout session id Stripe appended must match,
 * so only the browser that went through that payment sees it. Number, status and total only — no personal data.
 */
async function returnedOrder(params: Awaited<SearchParams>) {
  const id = params.order ?? "";
  const session = params.session_id ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^cs_[A-Za-z0-9_]{1,250}$/.test(session)) return null;
  const [o] = await db
    .select({
      id: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.stripeSessionId, session)));
  return o ?? null;
}

/** Return page after Stripe Checkout: the paid order's confirmation (paid only through the signed webhook). */
export default async function Success({ searchParams }: { searchParams: SearchParams }) {
  const order = await returnedOrder(await searchParams);
  const paid = order?.status === "paid";
  return (
    <ShopShell cartCount={0}>
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="mb-4 text-4xl font-bold">
          {paid ? "Payment confirmed" : "Thank you for your order"}
        </h1>
        {order ? (
          <p className="mb-2" data-testid="order-status" data-status={order.status}>
            Order {order.id.slice(0, 8).toUpperCase()} ·{" "}
            {formatPrice(order.totalCents, order.currency)} · {paid ? "paid" : "payment pending"}
          </p>
        ) : null}
        <p className="text-muted">
          {paid
            ? "We have received your payment. A confirmation email is on its way."
            : "We are confirming your payment. You will receive a confirmation email shortly."}
        </p>
        <Link href="/shop" className="mt-8 inline-block underline">
          Continue shopping
        </Link>
      </section>
    </ShopShell>
  );
}
