import type { Metadata } from "next";
import Link from "next/link";
import { ShopShell } from "@/components/shop-shell";
import { env } from "@/env";
import { cartTotal, formatPrice, MAX_QTY } from "@/lib/shop";
import { cartLines, currentCartId } from "@/server/cart";
import { updateQuantity } from "./actions";
import { CheckoutForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cart — __APP_NAME__", robots: { index: false } };

export default async function Cart() {
  const id = await currentCartId();
  const lines = id ? await cartLines(id) : [];
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <ShopShell cartCount={count}>
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="mb-6 text-4xl font-bold">Your cart</h1>
        {lines.length === 0 ? (
          <p className="text-slate-600">
            Your cart is empty.{" "}
            <Link className="underline" href="/shop">
              Browse the shop
            </Link>
            .
          </p>
        ) : (
          <>
            <ul className="mb-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {lines.map((l) => (
                <li key={l.productId} className="flex items-center justify-between gap-4 p-4">
                  <Link href={`/shop/${l.slug}`} className="font-medium">
                    {l.name}
                  </Link>
                  <form action={updateQuantity} className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="productId" value={l.productId} />
                    <input
                      aria-label={`Quantity of ${l.name}`}
                      name="quantity"
                      type="number"
                      min={0}
                      max={MAX_QTY}
                      defaultValue={l.quantity}
                      className="w-16 rounded-md border border-slate-300 px-2 py-1"
                    />
                    <button type="submit" className="underline">
                      Update
                    </button>
                  </form>
                  <span>{formatPrice(l.unitPriceCents * l.quantity, env.SHOP_CURRENCY)}</span>
                </li>
              ))}
            </ul>
            <p className="mb-6 text-right text-xl font-semibold" data-testid="cart-total">
              Total: {formatPrice(cartTotal(lines), env.SHOP_CURRENCY)}
            </p>
            <CheckoutForm />
          </>
        )}
      </section>
    </ShopShell>
  );
}
