import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addToCart } from "@/app/cart/actions";
import { ShopShell } from "@/components/shop-shell";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { productPrices, products, productVariants } from "@/db/schema";
import { env } from "@/env";
import { formatPrice, MAX_QTY, priceIn, productImageSrc } from "@/lib/shop";
import { jsonLd } from "@/lib/text";
import { currentCurrency, enabledCurrencies } from "@/server/currency";
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
      ...(productImageSrc(p) ? { images: [productImageSrc(p) as string] } : {}),
    },
  };
}

const available = (stock: number | null) => stock === null || stock > 0;

/** Product page: image (upload or https URL), options, price, stock and add to cart; schema.org Product. */
export default async function ProductPage({ params }: { params: Params }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const [rawVariants, local, currency] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.createdAt)),
    db.select().from(productPrices).where(eq(productPrices.productId, p.id)),
    currentCurrency(),
  ]);
  /** Price of the product (variantId null) or of an option in a currency, by the shop's rule (priceIn). */
  const price = (c: string, v: { id: string; priceCents: number | null } | null) =>
    priceIn({
      base: c === env.SHOP_CURRENCY,
      productBase: p.priceCents,
      variant: v !== null,
      variantBase: v?.priceCents ?? null,
      productLocal: local.find((l) => l.variantId === null && l.currency === c)?.priceCents ?? null,
      variantLocal: v
        ? (local.find((l) => l.variantId === v.id && l.currency === c)?.priceCents ?? null)
        : null,
    });
  const variants = rawVariants.map((v) => ({
    ...v,
    price: price(currency, v),
    inStock: available(v.stock),
  }));
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const imageSrc = productImageSrc(p);
  const inStock = variants.length > 0 ? variants.some((v) => v.inStock) : available(p.stock);
  const prices = (
    variants.length > 0 ? variants.map((v) => v.price) : [price(currency, null)]
  ).filter((x): x is number => x !== null);
  const sold = prices.length > 0;
  const firstAvailable = variants.findIndex((v) => v.inStock && v.price !== null);
  const offer = (
    c: string,
    o: { price: number | null; inStock: boolean; sku?: string | null; name?: string },
  ) =>
    o.price === null
      ? []
      : [
          {
            "@type": "Offer",
            ...(o.name ? { name: o.name } : {}),
            ...(o.sku ? { sku: o.sku } : {}),
            price: (o.price / 100).toFixed(2),
            priceCurrency: c.toUpperCase(),
            availability: o.inStock
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            url: `${base}/shop/${p.slug}`,
          },
        ];
  // One offer per option and currency with a price, so answer engines can quote each one exactly.
  const offers = enabledCurrencies().flatMap((c) =>
    rawVariants.length > 0
      ? rawVariants.flatMap((v) =>
          offer(c, {
            price: price(c, v),
            inStock: available(v.stock),
            sku: v.sku,
            name: `${p.name} — ${v.name}`,
          }),
        )
      : offer(c, { price: price(c, null), inStock }),
  );
  const product = jsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    ...(imageSrc ? { image: imageSrc.startsWith("/") ? `${base}${imageSrc}` : imageSrc } : {}),
    offers: offers.length === 1 ? offers[0] : offers,
  });
  return (
    <ShopShell cartCount={await cartCount()} back={`/shop/${p.slug}`}>
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by jsonLd(), "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: product }} />
      <article className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- own image route or the admin's https URL
          <img src={imageSrc} alt={p.name} className="w-full rounded-lg object-cover" />
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-lg bg-subtle text-muted">
            No image
          </div>
        )}
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold">{p.name}</h1>
          <p className="text-2xl" data-testid="price">
            {sold
              ? `${new Set(prices).size > 1 ? "From " : ""}${formatPrice(Math.min(...prices), currency)}`
              : `Not sold in ${currency.toUpperCase()}`}
          </p>
          <p className="whitespace-pre-line text-muted">{p.description}</p>
          {sold && variants.length === 0 && available(p.stock) ? (
            <p className="text-sm" data-testid="stock">
              {p.stock === null ? "In stock" : `${p.stock} in stock`}
            </p>
          ) : null}
          {inStock && sold ? (
            <form action={addToCart} className="flex flex-col items-start gap-4">
              <input type="hidden" name="productId" value={p.id} />
              {variants.length > 0 ? (
                // Native radios: keyboard and screen-reader friendly, no JavaScript needed.
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">Option</legend>
                  {variants.map((v, i) => (
                    <label
                      key={v.id}
                      className={`flex items-center gap-2 text-sm ${v.inStock && v.price !== null ? "" : "text-muted"}`}
                    >
                      <input
                        type="radio"
                        name="variantId"
                        value={v.id}
                        required
                        disabled={!v.inStock || v.price === null}
                        defaultChecked={i === firstAvailable}
                      />
                      {v.name} —{" "}
                      {v.price === null
                        ? `not sold in ${currency.toUpperCase()}`
                        : formatPrice(v.price, currency)}
                      {v.inStock ? (v.stock === null ? "" : ` (${v.stock} in stock)`) : " (sold out)"}
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
                    className="ml-2 w-20 rounded-md border border-field px-2 py-1"
                  />
                </label>
                <Button type="submit">Add to cart</Button>
              </div>
            </form>
          ) : (
            <p className="font-medium text-danger">{sold ? "Out of stock" : ""}</p>
          )}
        </div>
      </article>
    </ShopShell>
  );
}
