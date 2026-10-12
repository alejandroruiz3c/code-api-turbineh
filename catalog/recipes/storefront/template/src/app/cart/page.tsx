import type { Metadata } from "next";
import Link from "next/link";
import { ShopShell } from "@/components/shop-shell";
import { env } from "@/env";
import { checkoutCountries, countryName, isCountry } from "@/lib/countries";
import { formatPrice, formatRate, MAX_QTY, shippingCost, shipsTo, cartTotal } from "@/lib/shop";
import { cartLines, currentCartId, lineLabel, needsCountry, quote, shopRules } from "@/server/cart";
import { updateQuantity } from "./actions";
import { CheckoutForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cart — __APP_NAME__", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Cart({ searchParams }: { searchParams: SearchParams }) {
  const id = await currentCartId();
  const [lines, rules, sp] = await Promise.all([
    id ? cartLines(id) : [],
    shopRules(),
    searchParams,
  ]);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const money = (c: number) => formatPrice(c, env.SHOP_CURRENCY);
  const countries = checkoutCountries(rules.rates);
  const askCountry = needsCountry(rules);
  const country =
    typeof sp.country === "string" && isCountry(sp.country)
      ? sp.country
      : countries.length === 1
        ? (countries[0] ?? null)
        : null;
  const options = country ? rules.rates.filter((r) => shipsTo(r, country)) : [];
  const rateId =
    typeof sp.rate === "string" && options.some((r) => r.id === sp.rate)
      ? sp.rate
      : (options[0]?.id ?? null);
  const q = lines.length > 0 ? quote(lines, rules, country, rateId) : null;
  const subtotal = cartTotal(lines);
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
                <li key={l.lineId} className="flex items-center justify-between gap-4 p-4">
                  <Link href={`/shop/${l.slug}`} className="font-medium">
                    {lineLabel(l)}
                  </Link>
                  <form action={updateQuantity} className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="lineId" value={l.lineId} />
                    <input
                      aria-label={`Quantity of ${lineLabel(l)}`}
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
                  <span>{money(l.unitPriceCents * l.quantity)}</span>
                </li>
              ))}
            </ul>

            {askCountry ? (
              // A plain GET form: works without JavaScript and keeps the choice in the address.
              <form
                method="get"
                className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4"
              >
                <label className="text-sm font-medium" htmlFor="ship-country">
                  Ship to
                </label>
                <select
                  id="ship-country"
                  name="country"
                  defaultValue={country ?? ""}
                  className="rounded-md border border-slate-300 px-2 py-2"
                >
                  <option value="" disabled>
                    Choose a country
                  </option>
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {countryName(c)}
                    </option>
                  ))}
                </select>
                {options.length > 0 ? (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-medium">Shipping</legend>
                    {options.map((r) => {
                      const cost = shippingCost(r, subtotal);
                      return (
                        <label key={r.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="rate"
                            value={r.id}
                            defaultChecked={r.id === rateId}
                          />
                          {r.name} — {cost === 0 ? "Free" : money(cost)}
                          {r.freeOverCents !== null && cost > 0
                            ? ` (free from ${money(r.freeOverCents)})`
                            : ""}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <button type="submit" className="justify-self-start text-sm underline">
                  Update shipping
                </button>
              </form>
            ) : null}

            <dl
              className="mb-6 grid grid-cols-2 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-right"
              aria-label="Order summary"
            >
              <dt className="text-left text-slate-600">Subtotal</dt>
              <dd data-testid="cart-subtotal">{money(subtotal)}</dd>
              {q && !("error" in q) ? (
                <>
                  {q.shipping ? (
                    <>
                      <dt className="text-left text-slate-600">Shipping ({q.shipping.name})</dt>
                      <dd data-testid="cart-shipping">
                        {q.shippingCents === 0 ? "Free" : money(q.shippingCents)}
                      </dd>
                    </>
                  ) : null}
                  {q.tax ? (
                    <>
                      <dt className="text-left text-slate-600">
                        {q.pricesIncludeTax ? "Includes " : ""}
                        {q.tax.label} ({formatRate(q.tax.rateBp)})
                      </dt>
                      <dd data-testid="cart-tax">{money(q.taxCents)}</dd>
                    </>
                  ) : null}
                  <dt className="text-left text-xl font-semibold">Total</dt>
                  <dd className="text-xl font-semibold" data-testid="cart-total">
                    {money(q.totalCents)}
                  </dd>
                </>
              ) : (
                <>
                  <dt className="text-left text-xl font-semibold">Total</dt>
                  <dd className="text-xl font-semibold" data-testid="cart-total">
                    {money(subtotal)}
                  </dd>
                  {q && "error" in q ? (
                    <dd className="col-span-2 text-sm text-slate-600">{q.error}</dd>
                  ) : null}
                </>
              )}
            </dl>
            <CheckoutForm
              country={country}
              rateId={q && !("error" in q) ? (q.shipping?.id ?? null) : null}
              ready={!!q && !("error" in q)}
            />
          </>
        )}
      </section>
    </ShopShell>
  );
}
