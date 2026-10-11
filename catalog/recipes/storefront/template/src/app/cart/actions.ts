"use server";
import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { cartItems, orderItems, orders, products } from "@/db/schema";
import { env } from "@/env";
import { cartTotal, MAX_QTY } from "@/lib/shop";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { cartLines, currentCartId, ensureCart } from "@/server/cart";
import { createCheckoutSession } from "@/server/stripe";

async function guard(kind: string): Promise<void> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`${kind}:${ip}`, 30))
    throw new UserFacingError("Too many requests. Try again in a minute.");
}

// Shopping is public by design: the cart is identified by an unguessable httpOnly cookie, inputs are validated,
// prices always come from the database and requests are rate-limited.
// nosemgrep: turbineh.server-action-without-authz
export async function addToCart(formData: FormData): Promise<void> {
  await guard("cart");
  const productId = z.uuid().parse(formData.get("productId"));
  const qty = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_QTY)
    .parse(formData.get("quantity") ?? 1);
  const [p] = await db
    .select({ id: products.id, stock: products.stock })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)));
  if (!p) throw new UserFacingError("This product is not available.");
  const cartId = await ensureCart();
  await db
    .insert(cartItems)
    .values({ cartId, productId, quantity: qty })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId],
      set: { quantity: sql`least(${cartItems.quantity} + ${qty}, ${MAX_QTY})` },
    });
  revalidatePath("/cart");
  redirect("/cart");
}

// nosemgrep: turbineh.server-action-without-authz
export async function updateQuantity(formData: FormData): Promise<void> {
  await guard("cart");
  const cartId = await currentCartId();
  if (!cartId) return;
  const productId = z.uuid().parse(formData.get("productId"));
  const qty = z.coerce.number().int().min(0).max(MAX_QTY).parse(formData.get("quantity"));
  if (qty === 0)
    await db
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  else
    await db
      .update(cartItems)
      .set({ quantity: qty })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  revalidatePath("/cart");
}

export type CheckoutState = { ok: boolean; message: string } | null;

// nosemgrep: turbineh.server-action-without-authz
export async function checkout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  await guard("checkout");
  if (!env.STRIPE_SECRET_KEY)
    return {
      ok: false,
      message: "Online payments are not configured yet. Please contact us to order.",
    };
  const cartId = await currentCartId();
  const lines = cartId ? await cartLines(cartId) : [];
  if (lines.length === 0) return { ok: false, message: "Your cart is empty." };
  const short = lines.find((l) => l.stock !== null && l.stock < l.quantity);
  if (short) return { ok: false, message: `Only ${short.stock} left of ${short.name}.` };
  const email = z
    .email()
    .max(320)
    .optional()
    .safeParse(formData.get("email") || undefined);
  const [order] = await db
    .insert(orders)
    .values({
      cartId,
      email: email.success ? (email.data ?? null) : null,
      totalCents: cartTotal(lines),
      currency: env.SHOP_CURRENCY,
    })
    .returning({ id: orders.id });
  if (!order) return { ok: false, message: "Could not create the order." };
  await db.insert(orderItems).values(
    lines.map((l) => ({
      orderId: order.id,
      productId: l.productId,
      name: l.name,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
    })),
  );
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const session = await createCheckoutSession({
    orderId: order.id,
    lines,
    successUrl: `${base}/checkout/success?order=${order.id}`,
    cancelUrl: `${base}/cart`,
  }).catch(() => null);
  if (!session || new URL(session.url).hostname !== "checkout.stripe.com") {
    return { ok: false, message: "The payment page could not be opened. Please try again." };
  }
  await db.update(orders).set({ stripeSessionId: session.id }).where(eq(orders.id, order.id));
  // Stripe-hosted checkout page (constant host).
  // nosemgrep: turbineh.open-redirect
  redirect(session.url);
}
