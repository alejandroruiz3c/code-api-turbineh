import { desc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { coupons } from "@/db/schema";
import { describeCoupon } from "@/lib/shop";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";
import { deactivateCoupon, saveCoupon } from "./actions";

export default async function Coupons() {
  await requireAdmin();
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200);
  const currencies = enabledCurrencies();
  const lastDay = (d: Date | null) =>
    d ? new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10) : "—";
  return (
    <div className="flex flex-col gap-6">
      <Card title="New discount code">
        <p className="mb-4 text-sm text-slate-600">
          Buyers type the code in their cart (upper or lower case). The discount applies to
          products, before shipping and tax, and a use is counted only when the payment is
          confirmed.
        </p>
        <form action={saveCoupon} className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="cp-code">Code</Label>
            <Input id="cp-code" name="code" placeholder="SUMMER10" required maxLength={40} />
          </div>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-medium">Discount type</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="percent" defaultChecked /> Percent off
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="amount" /> Fixed amount off
            </label>
          </fieldset>
          <div>
            <Label htmlFor="cp-value">Discount value (% or amount)</Label>
            <Input id="cp-value" name="value" inputMode="decimal" placeholder="10" required />
          </div>
          <div>
            <Label htmlFor="cp-currency">Code currency</Label>
            <select
              id="cp-currency"
              name="currency"
              defaultValue=""
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">Any currency (percent codes)</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="cp-min">Minimum order (optional)</Label>
            <Input id="cp-min" name="minSubtotal" inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="cp-max">Maximum uses (optional)</Label>
            <Input id="cp-max" name="maxRedemptions" type="number" min={1} />
          </div>
          <div>
            <Label htmlFor="cp-until">Valid until (optional)</Label>
            <Input id="cp-until" name="validUntil" type="date" />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">Create code</Button>
          </div>
        </form>
      </Card>
      <Card title="Discount codes">
        <Table head={["Code", "Discount", "Used", "Valid until", "Status", ""]}>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-slate-100" data-code={c.code}>
              <td className="px-3 py-2 font-mono">{c.code}</td>
              <td className="px-3 py-2">{describeCoupon(c)}</td>
              <td className="px-3 py-2" data-testid={`coupon-used-${c.code}`}>
                {c.redemptions}
                {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ""}
              </td>
              <td className="px-3 py-2">{lastDay(c.expiresAt)}</td>
              <td className="px-3 py-2">{c.active ? "Active" : "Inactive"}</td>
              <td className="px-3 py-2 text-right">
                {c.active ? (
                  <form action={deactivateCoupon}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm text-red-600" type="submit">
                      Deactivate
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
