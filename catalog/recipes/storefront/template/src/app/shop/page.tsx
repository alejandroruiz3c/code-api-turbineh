import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ShopShell } from "@/components/shop-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { PAGE_SIZE, parsePage, parseQuery } from "@/lib/pagination";
import { searchPattern } from "@/lib/shop";
import { currentCurrency } from "@/server/currency";
import { inCurrency } from "@/server/prices";
import { cartCount } from "@/server/shop";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shop — __APP_NAME__",
  alternates: { canonical: "/shop" },
};
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Catalogue with search over names and descriptions, prices in the chosen currency, pagination. */
export default async function Shop({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { page, offset, limit } = parsePage(params.page);
  const q = parseQuery(params.q);
  const where = and(
    eq(products.active, true),
    // Search matches names and descriptions.
    q
      ? or(ilike(products.name, searchPattern(q)), ilike(products.description, searchPattern(q)))
      : undefined,
  );
  const currency = await currentCurrency();
  const [baseRows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        priceCents: products.priceCents,
        imageMime: products.imageMime,
        imageUrl: products.imageUrl,
      })
      .from(products)
      .where(where)
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(products).where(where),
  ]);
  const rows = await inCurrency(baseRows, currency);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/shop?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <ShopShell cartCount={await cartCount()} back={link(page)}>
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="mb-6 text-4xl font-bold">Shop</h1>
        <form role="search" className="mb-8 flex max-w-md gap-2">
          <Input
            aria-label="Search products"
            name="q"
            defaultValue={q}
            placeholder="Search products"
          />
          <Button type="submit">Search</Button>
        </form>
        {rows.length === 0 ? <p className="text-muted">No products found.</p> : null}
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {rows.map((p) => (
            <ProductCard key={p.id} p={p} currency={currency} />
          ))}
        </ul>
        <nav aria-label="Pagination" className="mt-8 flex gap-4 text-sm">
          {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)}>Next</Link> : null}
        </nav>
      </section>
    </ShopShell>
  );
}
