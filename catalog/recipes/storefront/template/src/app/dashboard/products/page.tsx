import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { productPrices, products, productVariants } from "@/db/schema";
import { env } from "@/env";
import { formatPrice } from "@/lib/shop";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";
import {
  deleteProduct,
  hideVariant,
  saveLocalPrices,
  saveProduct,
  saveVariant,
  setVariantStock,
} from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Products admin: create/edit (image upload or https URL), options with SKU/stock, prices per currency. */
export default async function Products({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const editId = (await searchParams).edit;
  const editing =
    typeof editId === "string" && /^[0-9a-f-]{36}$/.test(editId)
      ? ((await db.select().from(products).where(eq(products.id, editId)))[0] ?? null)
      : null;
  const variants = editing
    ? await db
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.productId, editing.id), eq(productVariants.active, true)))
        .orderBy(asc(productVariants.createdAt))
    : [];
  const extraCurrencies = enabledCurrencies().slice(1);
  const local =
    editing && extraCurrencies.length > 0
      ? await db.select().from(productPrices).where(eq(productPrices.productId, editing.id))
      : [];
  const localValue = (variantId: string | null, c: string) => {
    const hit = local.find((l) => l.variantId === variantId && l.currency === c);
    return hit ? (hit.priceCents / 100).toFixed(2) : "";
  };
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
              className="w-full rounded-md border border-field px-3 py-2 text-sm"
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
            <Label htmlFor="pr-image-url">Image URL (https://…, optional)</Label>
            <Input
              id="pr-image-url"
              name="imageUrl"
              type="url"
              maxLength={2048}
              pattern="https://.*"
              placeholder="https://example.com/product.jpg"
              defaultValue={editing?.imageUrl ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="pr-image">Or upload an image (PNG, JPEG or WebP, up to 2 MB)</Label>
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
      {editing ? (
        <Card title={`Options of ${editing.name}`}>
          <p className="mb-4 text-sm text-muted">
            Sizes, colours or any other choice. Each option has its own SKU and stock and can
            override the price. Products with options are bought through one of them.
          </p>
          {variants.length > 0 ? (
            <Table head={["Option", "SKU", "Price", "Stock", ""]}>
              {variants.map((v) => (
                <tr key={v.id} className="border-b border-line">
                  <td className="px-3 py-2">{v.name}</td>
                  <td className="px-3 py-2">{v.sku ?? "—"}</td>
                  <td className="px-3 py-2">
                    {formatPrice(v.priceCents ?? editing.priceCents, env.SHOP_CURRENCY)}
                  </td>
                  <td className="px-3 py-2">
                    <form action={setVariantStock} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={v.id} />
                      <input
                        aria-label={`Stock of ${v.name}`}
                        data-testid={`variant-stock-${v.name}`}
                        name="stock"
                        type="number"
                        min={0}
                        defaultValue={v.stock ?? ""}
                        placeholder="∞"
                        className="w-20 rounded-md border border-field px-2 py-1"
                      />
                      <button type="submit" className="text-sm underline">
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <form action={hideVariant}>
                      <input type="hidden" name="id" value={v.id} />
                      <button className="text-sm text-danger" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          ) : null}
          <form action={saveVariant} className="mt-4 grid gap-4 md:grid-cols-4">
            <input type="hidden" name="productId" value={editing.id} />
            <div>
              <Label htmlFor="va-name">Option name</Label>
              <Input id="va-name" name="name" placeholder="M / Blue" required maxLength={80} />
            </div>
            <div>
              <Label htmlFor="va-sku">SKU (optional)</Label>
              <Input id="va-sku" name="sku" maxLength={64} />
            </div>
            <div>
              <Label htmlFor="va-price">Option price (empty = product price)</Label>
              <Input id="va-price" name="price" inputMode="decimal" />
            </div>
            <div>
              <Label htmlFor="va-stock">Option stock (empty = unlimited)</Label>
              <Input id="va-stock" name="stock" type="number" min={0} />
            </div>
            <div className="md:col-span-4">
              <Button type="submit">Add option</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {editing && extraCurrencies.length > 0 ? (
        <Card title={`Prices of ${editing.name} in other currencies`}>
          <p className="mb-4 text-sm text-muted">
            Buyers paying in another currency see exactly these prices (no exchange rates). Empty =
            not sold in that currency; an option without its own price uses the product&apos;s.
          </p>
          <form action={saveLocalPrices}>
            <input type="hidden" name="productId" value={editing.id} />
            <Table head={["", ...extraCurrencies.map((c) => c.toUpperCase())]}>
              {[
                { id: null as string | null, name: "Product" },
                ...variants.map((v) => ({ id: v.id as string | null, name: `Option ${v.name}` })),
              ].map((row) => (
                <tr key={row.id ?? "product"} className="border-b border-line">
                  <td className="px-3 py-2">{row.name}</td>
                  {extraCurrencies.map((c) => (
                    <td key={c} className="px-3 py-2">
                      <input
                        aria-label={`${row.name} price in ${c.toUpperCase()}`}
                        name={`price:${row.id ?? "product"}:${c}`}
                        inputMode="decimal"
                        defaultValue={localValue(row.id, c)}
                        className="w-24 rounded-md border border-field px-2 py-1"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
            <Button type="submit" className="mt-4">
              Save prices
            </Button>
          </form>
        </Card>
      ) : null}
      <Card title="Products">
        <Table head={["Name", "Price", "Stock", "Status", ""]}>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line">
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
                    <button className="text-sm text-danger" type="submit">
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
