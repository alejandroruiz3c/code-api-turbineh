import { currentCartId, cartLines } from "@/server/cart";

/** Number of items in the visitor's cart (for the header). */
export async function cartCount(): Promise<number> {
  const id = await currentCartId();
  if (!id) return 0;
  return (await cartLines(id)).reduce((n, l) => n + l.quantity, 0);
}
