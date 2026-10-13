import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cartItems,
  carts,
  coupons,
  orderItems,
  orders,
  products,
  productVariants,
} from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { staffEmails } from "@/lib/staff";
import { formatPrice, orderSummary, stripePaidAmounts, verifyStripeSignature } from "@/lib/shop";

interface CheckoutCompleted {
  type: string;
  data: {
    object: {
      id: string;
      client_reference_id?: string | null;
      payment_status?: string;
      customer_details?: { email?: string | null };
      amount_total?: unknown;
      currency?: unknown;
      total_details?: { amount_tax?: unknown };
    };
  };
}

/**
 * Stripe webhook: the only place where an order becomes paid. Signature verified on the raw body; idempotent
 * (only pending orders change); stock decremented, the discount code counted and (Stripe Tax) the charged tax
 * recorded in the same transaction.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(raw) as CheckoutCompleted;
  if (event.type !== "checkout.session.completed" || event.data.object.payment_status !== "paid") {
    return Response.json({ received: true });
  }
  const session = event.data.object;
  // The event is signed by Stripe: our order id travels as client_reference_id (set when the session was created).
  const ref = /^[0-9a-f-]{36}$/.test(session.client_reference_id ?? "")
    ? session.client_reference_id
    : null;
  const match = ref
    ? or(eq(orders.stripeSessionId, session.id), eq(orders.id, ref))
    : eq(orders.stripeSessionId, session.id);
  const paid = await db.transaction(async (tx) => {
    const [order] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt: new Date(),
        email: sql`coalesce(${orders.email}, ${session.customer_details?.email ?? null})`,
      })
      .where(and(match, eq(orders.status, "pending")))
      .returning();
    if (!order) return null;
    // Stripe Tax: the tax and total Stripe charged come from this signed event (never from the browser).
    let paidOrder = order;
    if (order.taxMode === "stripe") {
      const amounts = stripePaidAmounts(session, order.currency);
      if (amounts) {
        const [updated] = await tx
          .update(orders)
          .set(amounts)
          .where(eq(orders.id, order.id))
          .returning();
        if (updated) paidOrder = updated;
      }
    }
    // A code counts once per paid order, never above its maximum, even with simultaneous payments.
    let couponOverLimit = false;
    if (order.couponId) {
      const counted = await tx
        .update(coupons)
        .set({ redemptions: sql`${coupons.redemptions} + 1` })
        .where(
          and(
            eq(coupons.id, order.couponId),
            or(isNull(coupons.maxRedemptions), lt(coupons.redemptions, coupons.maxRedemptions)),
          ),
        )
        .returning({ id: coupons.id });
      couponOverLimit = counted.length === 0;
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    for (const it of items) {
      // A variant line takes stock from its variant; other lines from the product (null stock = unlimited).
      if (it.variantId) {
        await tx
          .update(productVariants)
          .set({ stock: sql`greatest(${productVariants.stock} - ${it.quantity}, 0)` })
          .where(and(eq(productVariants.id, it.variantId), isNotNull(productVariants.stock)));
      } else if (it.productId) {
        await tx
          .update(products)
          .set({ stock: sql`greatest(${products.stock} - ${it.quantity}, 0)` })
          .where(and(eq(products.id, it.productId), isNotNull(products.stock)));
      }
    }
    if (order.cartId) {
      await tx.delete(cartItems).where(inArray(cartItems.cartId, [order.cartId]));
      await tx.update(carts).set({ couponId: null }).where(eq(carts.id, order.cartId));
    }
    return { order: paidOrder, items, couponOverLimit };
  });
  if (paid) {
    const summary =
      orderSummary(paid.order, paid.items) +
      (paid.couponOverLimit
        ? `\n\nNote: code ${paid.order.couponCode} had reached its limit when this payment arrived; the order was paid with the discount and honoured.`
        : "");
    const total = formatPrice(paid.order.totalCents, paid.order.currency);
    if (paid.order.email) {
      await sendEmail({
        to: paid.order.email,
        subject: "Your order is confirmed",
        text: `Thank you for your order.\n\n${summary}`,
      });
    }
    for (const to of staffEmails()) {
      await sendEmail({ to, subject: `New paid order (${total})`, text: summary });
    }
  }
  return Response.json({ received: true });
}
