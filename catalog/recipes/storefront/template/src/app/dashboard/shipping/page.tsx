import { asc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { shippingRates, taxRates } from "@/db/schema";
import { env } from "@/env";
import { countryName } from "@/lib/countries";
import { formatPrice, formatRate } from "@/lib/shop";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";
import { removeShippingRate, removeTaxRate, saveShippingRate, saveTaxRate } from "./actions";

export default async function ShippingAndTaxes() {
  await requireAdmin();
  const [rates, taxes] = await Promise.all([
    db
      .select()
      .from(shippingRates)
      .where(eq(shippingRates.active, true))
      .orderBy(asc(shippingRates.priceCents)),
    db.select().from(taxRates).orderBy(asc(taxRates.country)),
  ]);
  const currencies = enabledCurrencies();
  const money = (c: number, cur: string | null) => formatPrice(c, cur ?? env.SHOP_CURRENCY);
  const where = (countries: string) =>
    countries
      ? countries
          .split(",")
          .map((c) => countryName(c))
          .join(", ")
      : "All countries";
  return (
    <div className="flex flex-col gap-6">
      <Card title="Shipping options">
        <p className="mb-4 text-sm text-muted">
          Buyers choose one of the options that ship to their country. Without any option, orders
          need no shipping (digital goods or pick-up).
        </p>
        {rates.length > 0 ? (
          <Table head={["Option", "Countries", "Price", "Free from", ""]}>
            {/* Each option charges in its own currency and is offered to buyers paying in it. */}
            {rates.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{where(r.countries)}</td>
                <td className="px-3 py-2">
                  {r.priceCents === 0 ? "Free" : money(r.priceCents, r.currency)}
                </td>
                <td className="px-3 py-2">
                  {r.freeOverCents !== null ? money(r.freeOverCents, r.currency) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={removeShippingRate}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-sm text-danger" type="submit">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
        <form action={saveShippingRate} className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="sh-name">Shipping name</Label>
            <Input id="sh-name" name="name" placeholder="Standard (2–4 days)" required />
          </div>
          <div>
            <Label htmlFor="sh-countries">Countries (codes, empty = all)</Label>
            <Input id="sh-countries" name="countries" placeholder="ES, PT" />
          </div>
          <div>
            <Label htmlFor="sh-price">Shipping price</Label>
            <Input id="sh-price" name="price" inputMode="decimal" required />
          </div>
          {currencies.length > 1 ? (
            <div>
              <Label htmlFor="sh-currency">Shipping currency</Label>
              <select
                id="sh-currency"
                name="currency"
                defaultValue={env.SHOP_CURRENCY}
                className="w-full rounded-md border border-field px-2 py-2 text-sm"
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <Label htmlFor="sh-free">Free shipping from (optional)</Label>
            <Input id="sh-free" name="freeOver" inputMode="decimal" />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Add shipping option</Button>
          </div>
        </form>
      </Card>

      <Card title="Taxes">
        {env.SHOP_TAX_MODE === "stripe" ? (
          <p className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">
            Stripe Tax calculates tax at checkout from the buyer&apos;s address
            (SHOP_TAX_MODE=stripe): the rates below are not used. Keep your tax registrations up to
            date in your Stripe dashboard.
          </p>
        ) : null}
        <p className="mb-4 text-sm text-muted">
          {env.SHOP_PRICES_INCLUDE_TAX
            ? "Your prices include tax: the cart shows the tax they contain."
            : "Your prices exclude tax: the tax is added at checkout."}{" "}
          Tax applies to products and shipping, by the buyer&apos;s country. Use * for every other
          country.
        </p>
        {taxes.length > 0 ? (
          <Table head={["Country", "Tax", "Rate", ""]}>
            {taxes.map((t) => (
              <tr key={t.id} className="border-b border-line">
                <td className="px-3 py-2">
                  {t.country === "*" ? "Every other country" : countryName(t.country)}
                </td>
                <td className="px-3 py-2">{t.label}</td>
                <td className="px-3 py-2">{formatRate(t.rateBp)}</td>
                <td className="px-3 py-2 text-right">
                  <form action={removeTaxRate}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-sm text-danger" type="submit">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
        <form action={saveTaxRate} className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="tx-country">Tax country (code or *)</Label>
            <Input id="tx-country" name="country" placeholder="ES" required maxLength={2} />
          </div>
          <div>
            <Label htmlFor="tx-label">Tax name</Label>
            <Input id="tx-label" name="label" placeholder="VAT" required maxLength={40} />
          </div>
          <div>
            <Label htmlFor="tx-rate">Tax rate (%)</Label>
            <Input id="tx-rate" name="rate" inputMode="decimal" placeholder="21" required />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">Save tax rate</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
