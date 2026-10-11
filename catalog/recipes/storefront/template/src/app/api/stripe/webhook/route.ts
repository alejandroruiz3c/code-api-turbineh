import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cartItems, orderItems, orders, products } from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { formatPrice, verifyStripeSignature } from "@/lib/shop";

interface CheckoutCompleted {
  type: string;
  data: {
    object: { id: string; payment_status?: string; customer_details?: { email?: string | null } };
  };
}

/**
 * Stripe webhook: the only place where an order becomes paid. Signature verified on the raw body; idempotent
 * (only pending orders change); stock decremented in the same transaction.
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
  const paid = await db.transaction(async (tx) => {
    const [order] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt: new Date(),
        email: sql`coalesce(${orders.email}, ${session.customer_details?.email ?? null})`,
      })
      .where(and(eq(orders.stripeSessionId, session.id), eq(orders.status, "pending")))
      .returning();
    if (!order) return null;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    for (const it of items) {
      if (!it.productId) continue;
      await tx
        .update(products)
        .set({ stock: sql`greatest(${products.stock} - ${it.quantity}, 0)` })
        .where(and(eq(products.id, it.productId), isNotNull(products.stock)));
    }
    if (order.cartId) await tx.delete(cartItems).where(inArray(cartItems.cartId, [order.cartId]));
    return { order, items };
  });
  if (paid) {
    const summary = paid.items.map((i) => `${i.quantity} × ${i.name}`).join("\n");
    const total = formatPrice(paid.order.totalCents, paid.order.currency);
    if (paid.order.email) {
      await sendEmail({
        to: paid.order.email,
        subject: "Your order is confirmed",
        text: `Thank you for your order.\n\n${summary}\n\nTotal: ${total}`,
      });
    }
    for (const to of env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim())
      .filter(Boolean)) {
      await sendEmail({ to, subject: `New paid order (${total})`, text: summary });
    }
  }
  return Response.json({ received: true });
}
