import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { productPrices } from "@/db/schema";
import { env } from "@/env";

/**
 * Product prices for a list of products in `currency`: the base price in the base currency, the admin's explicit
 * price in another one (null = not sold in that currency).
 */
export async function inCurrency<T extends { id: string; priceCents: number }>(
  rows: T[],
  currency: string,
): Promise<(Omit<T, "priceCents"> & { priceCents: number | null })[]> {
  if (currency === env.SHOP_CURRENCY || rows.length === 0) return rows;
  const local = await db
    .select({ productId: productPrices.productId, priceCents: productPrices.priceCents })
    .from(productPrices)
    .where(
      and(
        inArray(
          productPrices.productId,
          rows.map((r) => r.id),
        ),
        isNull(productPrices.variantId),
        eq(productPrices.currency, currency),
      ),
    );
  const byId = new Map(local.map((l) => [l.productId, l.priceCents]));
  return rows.map((r) => ({ ...r, priceCents: byId.get(r.id) ?? null }));
}
