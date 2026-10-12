import Link from "next/link";
import type { ReactNode } from "react";
import { setCurrency } from "@/app/currency/actions";
import { BRAND } from "@/brand";
import { currentCurrency, enabledCurrencies } from "@/server/currency";

/** Public shop frame: header with catalog, currency (when the shop sells in several) and cart, footer. */
export async function ShopShell({
  children,
  cartCount,
  back = "/shop",
}: {
  children: ReactNode;
  cartCount: number;
  /** Page to come back to after changing the currency. */
  back?: string;
}) {
  const currencies = enabledCurrencies();
  const currency = await currentCurrency();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            {BRAND.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
              <img src={BRAND.logo} alt="" className="h-8 w-auto" />
            ) : null}
            __APP_NAME__
          </Link>
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            <Link href="/shop">Shop</Link>
            {currencies.length > 1 ? (
              // A plain form: works without JavaScript; the server checks the value against the shop's list.
              <form action={setCurrency} className="flex items-center gap-1">
                <input type="hidden" name="back" value={back} />
                <label htmlFor="shop-currency" className="sr-only">
                  Currency
                </label>
                <select
                  id="shop-currency"
                  name="currency"
                  defaultValue={currency}
                  className="rounded-md border border-slate-300 px-2 py-1"
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
                <button type="submit" className="underline">
                  Change
                </button>
              </form>
            ) : null}
            <Link
              href="/cart"
              className="rounded-md bg-brand px-4 py-2 font-medium text-brand-contrast"
            >
              Cart ({cartCount})
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} __APP_NAME__ · Secure payments by Stripe ·{" "}
        <Link href="/sign-in" className="underline">
          Admin
        </Link>
      </footer>
    </div>
  );
}
