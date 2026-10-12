import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addToCart } from "@/app/cart/actions";
import { ShopShell } from "@/components/shop-shell";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { products, productVariants } from "@/db/schema";
import { env } from "@/env";
import { formatPrice, MAX_QTY } from "@/lib/shop";
import { jsonLd } from "@/lib/text";
import { cartCount } from "@/server/shop";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.active, true)));
  return p ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Not found" };
  return {
    title: `${p.name} — __APP_NAME__`,
    description: p.description.slice(0, 160),
    alternates: { canonical: `/shop/${p.slug}` },
    openGraph: {
      title: p.name,
      description: p.description.slice(0, 160),
      type: "website",
      ...(p.imageMime ? { images: [`/shop/images/${p.id}`] } : {}),
    },
  };
}

const available = (stock: number | null) => stock === null || stock > 0;

export default async function ProductPage({ params }: { params: Params }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const variants = (
    await db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.createdAt))
  ).map((v) => ({ ...v, price: v.priceCents ?? p.priceCents, inStock: available(v.stock) }));
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const inStock = variants.length > 0 ? variants.some((v) => v.inStock) : available(p.stock);
  const prices = variants.length > 0 ? variants.map((v) => v.price) : [p.priceCents];
  const firstAvailable = variants.findIndex((v) => v.inStock);
  const offer = (o: { price: number; inStock: boolean; sku?: string | null; name?: string }) => ({
    "@type": "Offer",
    ...(o.name ? { name: o.name } : {}),
    ...(o.sku ? { sku: o.sku } : {}),
    price: (o.price / 100).toFixed(2),
    priceCurrency: env.SHOP_CURRENCY.toUpperCase(),
    availability: o.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    url: `${base}/shop/${p.slug}`,
  });
  const product = jsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    ...(p.imageMime ? { image: `${base}/shop/images/${p.id}` } : {}),
    // One offer per variant (with its SKU), so answer engines can quote each option's price and stock.
    offers:
      variants.length > 0
        ? variants.map((v) => offer({ ...v, name: `${p.name} — ${v.name}` }))
        : offer({ price: p.priceCents, inStock }),
  });
  return (
    <ShopShell cartCount={await cartCount()}>
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by jsonLd(), "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: product }} />
      <article className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
        {p.imageMime ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own image route
          <img
            src={`/shop/images/${p.id}`}
            alt={p.name}
            className="w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-slate-400">
            No image
          </div>
        )}
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold">{p.name}</h1>
          <p className="text-2xl" data-testid="price">
            {new Set(prices).size > 1 ? "From " : ""}
            {formatPrice(Math.min(...prices), env.SHOP_CURRENCY)}
          </p>
          <p className="whitespace-pre-line text-slate-700">{p.description}</p>
          {inStock ? (
            <form action={addToCart} className="flex flex-col items-start gap-4">
              <input type="hidden" name="productId" value={p.id} />
              {variants.length > 0 ? (
                // Native radios: keyboard and screen-reader friendly, no JavaScript needed.
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">Option</legend>
                  {variants.map((v, i) => (
                    <label
                      key={v.id}
                      className={`flex items-center gap-2 text-sm ${v.inStock ? "" : "text-slate-400"}`}
                    >
                      <input
                        type="radio"
                        name="variantId"
                        value={v.id}
                        required
                        disabled={!v.inStock}
                        defaultChecked={i === firstAvailable}
                      />
                      {v.name} — {formatPrice(v.price, env.SHOP_CURRENCY)}
                      {v.inStock ? "" : " (sold out)"}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className="flex items-end gap-3">
                <label className="text-sm">
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    max={MAX_QTY}
                    defaultValue={1}
                    className="ml-2 w-20 rounded-md border border-slate-300 px-2 py-1"
                  />
                </label>
                <Button type="submit">Add to cart</Button>
              </div>
            </form>
          ) : (
            <p className="font-medium text-red-600">Out of stock</p>
          )}
        </div>
      </article>
    </ShopShell>
  );
}
