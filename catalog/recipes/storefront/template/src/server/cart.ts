import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { cartItems, carts, products } from "@/db/schema";
import { env } from "@/env";

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

/** Cart lines with current prices from the database (never from the browser). */
export async function cartLines(cartId: string) {
  return db
    .select({
      productId: products.id,
      slug: products.slug,
      name: products.name,
      unitPriceCents: products.priceCents,
      stock: products.stock,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(and(eq(cartItems.cartId, cartId), eq(products.active, true)));
}

export async function clearCart(cartId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}
