import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { cartItems, carts, products, productVariants, shippingRates, taxRates } from "@/db/schema";
import { env } from "@/env";
import { countryName } from "@/lib/countries";
import { cartTotal, orderTotals, shippingCost, shipsTo, taxFor, type Totals } from "@/lib/shop";

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

/**
 * Cart lines with current prices and stock from the database (never from the browser). A variant's own price and
 * stock win over the product's; lines whose product or variant was hidden are left out.
 */
export async function cartLines(cartId: string) {
  return db
    .select({
      lineId: cartItems.id,
      productId: products.id,
      variantId: productVariants.id,
      slug: products.slug,
      name: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      unitPriceCents: sql<number>`coalesce(${productVariants.priceCents}, ${products.priceCents})`,
      stock: sql<
        number | null
      >`case when ${productVariants.id} is null then ${products.stock} else ${productVariants.stock} end`,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
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

export async function clearCart(cartId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

/** Active shipping rates and tax rates (small admin-managed tables). */
export async function shopRules() {
  const [rates, taxes] = await Promise.all([
    db
      .select()
      .from(shippingRates)
      .where(eq(shippingRates.active, true))
      .orderBy(asc(shippingRates.priceCents)),
    db.select().from(taxRates),
  ]);
  return { rates, taxes };
}

type Rules = Awaited<ReturnType<typeof shopRules>>;

/** The buyer's country is asked only when the shop ships or charges tax. */
export const needsCountry = (rules: Rules) => rules.rates.length > 0 || rules.taxes.length > 0;

export interface Quote extends Totals {
  country: string | null;
  shipping: { id: string; name: string } | null;
  tax: { label: string; rateBp: number } | null;
  pricesIncludeTax: boolean;
}

/**
 * Server-side quote for a cart: the shipping rate must exist, be active and ship to the country; tax comes from the
 * country's rate. Returns an error message instead when the choice is not valid.
 */
export function quote(
  lines: CartLine[],
  rules: Rules,
  country: string | null,
  rateId: string | null,
): Quote | { error: string } {
  const subtotalCents = cartTotal(lines);
  if (!country && needsCountry(rules)) return { error: "Choose the country to ship to." };
  let shipping: Rules["rates"][number] | null = null;
  if (country && rules.rates.length > 0) {
    const available = rules.rates.filter((r) => shipsTo(r, country));
    if (available.length === 0) return { error: `We do not ship to ${countryName(country)} yet.` };
    shipping = available.find((r) => r.id === rateId) ?? null;
    if (!shipping) return { error: "Choose a shipping option." };
  }
  const tax = country ? taxFor(rules.taxes, country) : null;
  const totals = orderTotals({
    subtotalCents,
    shippingCents: shipping ? shippingCost(shipping, subtotalCents) : 0,
    rateBp: tax?.rateBp ?? 0,
    pricesIncludeTax: env.SHOP_PRICES_INCLUDE_TAX,
  });
  return {
    ...totals,
    country,
    shipping: shipping ? { id: shipping.id, name: shipping.name } : null,
    tax: tax ? { label: tax.label, rateBp: tax.rateBp } : null,
    pricesIncludeTax: env.SHOP_PRICES_INCLUDE_TAX,
  };
}
