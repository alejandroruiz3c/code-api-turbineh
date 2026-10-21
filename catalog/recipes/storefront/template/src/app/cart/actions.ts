"use server";
import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
import { isCountry } from "@/lib/countries";
import { COUPON_CODE, couponDiscount, formatRate, MAX_QTY, normalizeCode } from "@/lib/shop";
import { UserFacingError } from "@/security/errors";
import { clientIp } from "@/security/client-ip";
import { rateLimit } from "@/security/rate-limit";
import {
  cartCoupon,
  cartLines,
  currentCartId,
  ensureCart,
  lineLabel,
  needsCountry,
  pricedLines,
  quote,
  shopRules,
} from "@/server/cart";
import { currentCurrency } from "@/server/currency";
import { createCheckoutSession } from "@/server/stripe";

async function guard(kind: string, perMinute = 30): Promise<void> {
  const h = await headers();
  // Behind trusted proxies only: a client cannot choose its own bucket (src/security/client-ip.ts).
  const ip = clientIp(h);
  if (!(await rateLimit(`${kind}:${ip}`, perMinute)))
    throw new UserFacingError("Too many requests. Try again in a minute.");
}

export type CouponState = { ok: boolean; message: string } | null;

/**
 * Attaches a discount code to the visitor's cart after checking it against the current cart. Few attempts per
 * minute per address, and the same answer for unknown and inactive codes, so codes cannot be guessed by trying.
 */
// nosemgrep: turbineh.server-action-without-authz
export async function applyCoupon(_prev: CouponState, formData: FormData): Promise<CouponState> {
  await guard("coupon", 8);
  const code = normalizeCode(String(formData.get("code") ?? ""));
  const cartId = await currentCartId();
  if (!cartId) return { ok: false, message: "Your cart is empty." };
  if (!COUPON_CODE.test(code)) return { ok: false, message: "This code is not valid." };
  const [c] = await db.select().from(coupons).where(eq(coupons.code, code));
  if (!c) return { ok: false, message: "This code is not valid." };
  const currency = await currentCurrency();
  const lines = await cartLines(cartId, currency);
  const subtotal = pricedLines(lines).reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const d = couponDiscount(c, subtotal, currency);
  if ("error" in d) return { ok: false, message: d.error };
  await db.update(carts).set({ couponId: c.id }).where(eq(carts.id, cartId));
  revalidatePath("/cart");
  return { ok: true, message: `Code ${c.code} applied.` };
}

// nosemgrep: turbineh.server-action-without-authz
export async function removeCoupon(): Promise<void> {
  await guard("cart");
  const cartId = await currentCartId();
  if (cartId) await db.update(carts).set({ couponId: null }).where(eq(carts.id, cartId));
  revalidatePath("/cart");
}

// Shopping is public by design: the cart is identified by an unguessable httpOnly cookie, inputs are validated,
// prices always come from the database and requests are rate-limited.
// nosemgrep: turbineh.server-action-without-authz
export async function addToCart(formData: FormData): Promise<void> {
  await guard("cart");
  const productId = z.uuid().parse(formData.get("productId"));
  const variantId = formData.get("variantId") ? z.uuid().parse(formData.get("variantId")) : null;
  const qty = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_QTY)
    .parse(formData.get("quantity") ?? 1);
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)));
  if (!p) throw new UserFacingError("This product is not available.");
  const variants = await db
    .select({ id: productVariants.id, stock: productVariants.stock })
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.active, true)));
  // A product with variants is always bought through one of its own variants.
  if (variants.length > 0) {
    const v = variants.find((x) => x.id === variantId);
    if (!v) throw new UserFacingError("Choose an option first.");
    if (v.stock !== null && v.stock <= 0) throw new UserFacingError("This option is sold out.");
  } else if (variantId) {
    throw new UserFacingError("This option is not available.");
  }
  const cartId = await ensureCart();
  await db
    .insert(cartItems)
    .values({ cartId, productId, variantId, quantity: qty })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId, cartItems.variantId],
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
  const lineId = z.uuid().parse(formData.get("lineId"));
  const qty = z.coerce.number().int().min(0).max(MAX_QTY).parse(formData.get("quantity"));
  // Scoped to the visitor's own cart: a line id from another cart matches nothing.
  const own = and(eq(cartItems.cartId, cartId), eq(cartItems.id, lineId));
  if (qty === 0) await db.delete(cartItems).where(own);
  else await db.update(cartItems).set({ quantity: qty }).where(own);
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
  const currency = await currentCurrency();
  const lines = cartId ? await cartLines(cartId, currency) : [];
  if (!cartId || lines.length === 0) return { ok: false, message: "Your cart is empty." };
  const short = lines.find((l) => l.stock !== null && l.stock < l.quantity);
  if (short) return { ok: false, message: `Only ${short.stock} left of ${lineLabel(short)}.` };
  const [rules, coupon] = await Promise.all([shopRules(currency), cartCoupon(cartId)]);
  const country = z
    .string()
    .regex(/^[A-Z]{2}$/)
    .refine(isCountry)
    .safeParse(formData.get("country"));
  // The country matters only when the shop ships or charges tax.
  if (!country.success && needsCountry(rules))
    return { ok: false, message: "Choose the country to ship to." };
  const rateId = z.uuid().safeParse(formData.get("rateId"));
  // Every amount is recomputed here from the database: nothing the browser sends is trusted.
  const q = quote(
    lines,
    rules,
    country.success ? country.data : null,
    rateId.success ? rateId.data : null,
    { currency, coupon },
  );
  if ("error" in q) return { ok: false, message: q.error };
  // The buyer saw the code fail in the cart: never charge without the discount they expect.
  if (q.couponError) return { ok: false, message: `${q.couponError} Remove the code to continue.` };
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
      subtotalCents: q.subtotalCents,
      discountCents: q.discountCents,
      couponId: q.coupon?.id ?? null,
      couponCode: q.coupon?.code ?? null,
      shippingCents: q.shippingCents,
      taxCents: q.taxCents,
      taxMode: q.taxMode,
      pricesIncludeTax: q.pricesIncludeTax,
      taxLabel:
        q.taxMode === "stripe"
          ? "Tax (Stripe Tax)"
          : q.tax
            ? `${q.tax.label} (${formatRate(q.tax.rateBp)})`
            : null,
      shippingName: q.shipping?.name ?? null,
      country: q.country,
      totalCents: q.totalCents,
      currency: q.currency,
    })
    .returning({ id: orders.id });
  if (!order) return { ok: false, message: "Could not create the order." };
  const priced = pricedLines(lines);
  await db.insert(orderItems).values(
    priced.map((l) => ({
      orderId: order.id,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      variantName: l.variantName,
      sku: l.sku,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
    })),
  );
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const session = await createCheckoutSession({
    orderId: order.id,
    currency: q.currency,
    lines: priced.map((l) => ({ ...l, name: lineLabel(l) })),
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    couponCode: q.coupon?.code ?? null,
    shipping: q.shipping ? { name: q.shipping.name, cents: q.shippingCents } : null,
    country: q.country,
    tax: q.tax ? { ...q.tax, cents: q.taxCents } : null,
    taxMode: q.taxMode,
    pricesIncludeTax: q.pricesIncludeTax,
    // Stripe replaces {CHECKOUT_SESSION_ID}: the return page shows this order only to the browser that paid it.
    successUrl: `${base}/checkout/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
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
