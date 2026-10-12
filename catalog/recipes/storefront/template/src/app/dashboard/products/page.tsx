import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { env } from "@/env";
import { formatPrice } from "@/lib/shop";
import { requireAdmin } from "@/server/admin";
import { deleteProduct, saveProduct } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Products({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const editId = (await searchParams).edit;
  const editing =
    typeof editId === "string" && /^[0-9a-f-]{36}$/.test(editId)
      ? ((await db.select().from(products).where(eq(products.id, editId)))[0] ?? null)
      : null;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      priceCents: products.priceCents,
      stock: products.stock,
      active: products.active,
    })
    .from(products)
    .orderBy(desc(products.createdAt))
    .limit(200);
  return (
    <div className="flex flex-col gap-6">
      <Card title={editing ? "Edit product" : "New product"}>
        <form action={saveProduct} className="grid gap-4 md:grid-cols-2">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div>
            <Label htmlFor="pr-name">Name</Label>
            <Input id="pr-name" name="name" defaultValue={editing?.name} required maxLength={160} />
          </div>
          <div>
            <Label htmlFor="pr-price">Price ({env.SHOP_CURRENCY.toUpperCase()})</Label>
            <Input
              id="pr-price"
              name="price"
              inputMode="decimal"
              defaultValue={editing ? (editing.priceCents / 100).toFixed(2) : ""}
              required
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="pr-desc">Description</Label>
            <textarea
              id="pr-desc"
              name="description"
              defaultValue={editing?.description}
              required
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pr-stock">Stock (empty = unlimited)</Label>
            <Input
              id="pr-stock"
              name="stock"
              type="number"
              min={0}
              defaultValue={editing?.stock ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="pr-image">Image (PNG, JPEG or WebP, up to 2 MB)</Label>
            <input
              id="pr-image"
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Visible
            in the shop
          </label>
          <div className="md:col-span-2">
            <Button type="submit">{editing ? "Save product" : "Create product"}</Button>
          </div>
        </form>
      </Card>
      <Card title="Products">
        <Table head={["Name", "Price", "Stock", "Status", ""]}>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="px-3 py-2">
                <Link className="underline" href={`/dashboard/products?edit=${p.id}`}>
                  {p.name}
                </Link>
              </td>
              <td className="px-3 py-2">{formatPrice(p.priceCents, env.SHOP_CURRENCY)}</td>
              <td className="px-3 py-2" data-testid={`stock-${p.name}`}>
                {p.stock ?? "∞"}
              </td>
              <td className="px-3 py-2">{p.active ? "Visible" : "Hidden"}</td>
              <td className="px-3 py-2 text-right">
                {p.active ? (
                  <form action={deleteProduct}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-sm text-red-600" type="submit">
                      Hide
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
