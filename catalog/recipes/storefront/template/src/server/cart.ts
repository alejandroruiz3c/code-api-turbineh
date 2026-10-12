import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import {
  cartItems,
  carts,
  coupons,
  productPrices,
  products,
  productVariants,
  shippingRates,
  taxRates,
} from "@/db/schema";
import { env } from "@/env";
import { countryName } from "@/lib/countries";
import {
  cartTotal,
  couponDiscount,
  MIN_CHARGE_CENTS,
  orderTotals,
  shippingCost,
  shipsTo,
  taxFor,
  type Coupon,
  type Totals,
} from "@/lib/shop";

const COOKIE = "cart_id";
const UUID = /^[0-9a-f-]{36}$/;

/** The visitor's cart id from its httpOnly cookie (null if none or malformed). */
export async function currentCartId(): Promise<string | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  return v && UUID.test(v) ? v : null;
}

/** Existing cart or a new one; only callable from server actions (sets the cookie). */
export async function ensureCart(): Promise<string> {
  const id = await currentCartId();
  if (id && (await db.select({ id: carts.id }).from(carts).where(eq(carts.id, id))).length > 0)
    return id;
  const [row] = await db.insert(carts).values({}).returning({ id: carts.id });
  if (!row) throw new Error("cart not created");
  (await cookies()).set(COOKIE, row.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return row.id;
}

const productLocal = alias(productPrices, "product_local");
const variantLocal = alias(productPrices, "variant_local");

/**
 * Cart lines with current prices and stock from the database (never from the browser), in `currency`. A variant's
 * own price and stock win over the product's (same rule as priceIn()); unitPriceCents is null when the line is not
 * sold in that currency. Lines whose product or variant was hidden are left out.
 */
export async function cartLines(cartId: string, currency: string = env.SHOP_CURRENCY) {
  const base = currency === env.SHOP_CURRENCY;
  const unitPrice = base
    ? sql<number | null>`coalesce(${productVariants.priceCents}, ${products.priceCents})`
    : sql<number | null>`case when ${productVariants.id} is null then ${productLocal.priceCents}
        else coalesce(${variantLocal.priceCents},
          case when ${productVariants.priceCents} is null then ${productLocal.priceCents} end) end`;
  return db
    .select({
      lineId: cartItems.id,
      productId: products.id,
      variantId: productVariants.id,
      slug: products.slug,
      name: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      unitPriceCents: unitPrice,
      stock: sql<
        number | null
      >`case when ${productVariants.id} is null then ${products.stock} else ${productVariants.stock} end`,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(
      productLocal,
      and(
        eq(productLocal.productId, products.id),
        isNull(productLocal.variantId),
        eq(productLocal.currency, currency),
      ),
    )
    .leftJoin(
      variantLocal,
      and(eq(variantLocal.variantId, productVariants.id), eq(variantLocal.currency, currency)),
    )
    .where(
      and(
        eq(cartItems.cartId, cartId),
        eq(products.active, true),
        or(isNull(cartItems.variantId), eq(productVariants.active, true)),
      ),
    )
    .orderBy(asc(products.name), asc(productVariants.name));
}

export type CartLine = Awaited<ReturnType<typeof cartLines>>[number];

export const lineLabel = (l: { name: string; variantName: string | null }) =>
  l.variantName ? `${l.name} — ${l.variantName}` : l.name;

/** Lines priced in the cart's currency (lines not sold in it are reported by quote()). */
export const pricedLines = (lines: CartLine[]) =>
  lines.map((l) => ({ ...l, unitPriceCents: l.unitPriceCents ?? 0 }));

export async function clearCart(cartId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

/** Discount code attached to the cart, if any. */
export async function cartCoupon(cartId: string): Promise<(Coupon & { id: string }) | null> {
  const [row] = await db
    .select({ coupon: coupons })
    .from(carts)
    .innerJoin(coupons, eq(coupons.id, carts.couponId))
    .where(eq(carts.id, cartId));
  return row?.coupon ?? null;
}

/** Active shipping rates in `currency` and tax rates (small admin-managed tables). */
export async function shopRules(currency: string = env.SHOP_CURRENCY) {
  const inCurrency =
    currency === env.SHOP_CURRENCY
      ? or(isNull(shippingRates.currency), eq(shippingRates.currency, currency))
      : eq(shippingRates.currency, currency);
  const [rates, taxes] = await Promise.all([
    db
      .select()
      .from(shippingRates)
      .where(and(eq(shippingRates.active, true), inCurrency))
      .orderBy(asc(shippingRates.priceCents)),
    db.select().from(taxRates),
  ]);
  return { rates, taxes };
}

type Rules = Awaited<ReturnType<typeof shopRules>>;

/** The buyer's country is asked when the shop ships, or charges its own tax rates (Stripe Tax asks on its page). */
export const needsCountry = (rules: Rules) =>
  rules.rates.length > 0 || (env.SHOP_TAX_MODE === "manual" && rules.taxes.length > 0);

export interface Quote extends Totals {
  currency: string;
  country: string | null;
  shipping: { id: string; name: string } | null;
  tax: { label: string; rateBp: number } | null;
  taxMode: "manual" | "stripe";
  pricesIncludeTax: boolean;
  coupon: { id: string; code: string } | null;
  /** Why the cart's code does not apply right now (the quote is then without discount). */
  couponError: string | null;
}

/**
 * Server-side quote for a cart, in the cart's currency: every line must be sold in it; the discount code is
 * re-validated; the shipping rate must exist, be active, be in that currency and ship to the country (its free-from
 * threshold applies to the discounted goods); tax comes from the country's rate, or from Stripe Tax at checkout.
 * Returns an error message instead when the order cannot be placed as is.
 */
export function quote(
  lines: CartLine[],
  rules: Rules,
  country: string | null,
  rateId: string | null,
  opts: { currency?: string; coupon?: (Coupon & { id: string }) | null; now?: Date } = {},
): Quote | { error: string } {
  const currency = opts.currency ?? env.SHOP_CURRENCY;
  const missing = lines.find((l) => l.unitPriceCents === null);
  if (missing)
    return {
      error: `${lineLabel(missing)} is not sold in ${currency.toUpperCase()}. Choose another currency or remove it.`,
    };
  const subtotalCents = cartTotal(pricedLines(lines));
  let discountCents = 0;
  let couponError: string | null = null;
  if (opts.coupon) {
    const d = couponDiscount(opts.coupon, subtotalCents, currency, opts.now);
    if ("error" in d) couponError = d.error;
    else discountCents = d.discountCents;
  }
  if (!country && needsCountry(rules)) return { error: "Choose the country to ship to." };
  let shipping: Rules["rates"][number] | null = null;
  if (country && rules.rates.length > 0) {
    const available = rules.rates.filter((r) => shipsTo(r, country));
    if (available.length === 0) return { error: `We do not ship to ${countryName(country)} yet.` };
    shipping = available.find((r) => r.id === rateId) ?? null;
    if (!shipping) return { error: "Choose a shipping option." };
  }
  const taxMode = env.SHOP_TAX_MODE;
  const tax = taxMode === "manual" && country ? taxFor(rules.taxes, country) : null;
  const totals = orderTotals({
    subtotalCents,
    discountCents,
    shippingCents: shipping ? shippingCost(shipping, subtotalCents - discountCents) : 0,
    rateBp: tax?.rateBp ?? 0,
    pricesIncludeTax: env.SHOP_PRICES_INCLUDE_TAX,
  });
  if (totals.totalCents < MIN_CHARGE_CENTS)
    return { error: "The order total is below the minimum card payment." };
  return {
    ...totals,
    currency,
    country,
    shipping: shipping ? { id: shipping.id, name: shipping.name } : null,
    tax: tax ? { label: tax.label, rateBp: tax.rateBp } : null,
    taxMode,
    pricesIncludeTax: env.SHOP_PRICES_INCLUDE_TAX,
    coupon: opts.coupon && !couponError ? { id: opts.coupon.id, code: opts.coupon.code } : null,
    couponError,
  };
}
