import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ShopShell } from "@/components/shop-shell";
import { SITE } from "@/content/site";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { env } from "@/env";
import { faqJsonLd, websiteJsonLd } from "@/lib/geo";
import { currentCurrency } from "@/server/currency";
import { inCurrency } from "@/server/prices";
import { cartCount } from "@/server/shop";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `__APP_NAME__ — ${SITE.tagline}`,
  description: SITE.hero_subtitle,
  alternates: { canonical: "/" },
  openGraph: { title: "__APP_NAME__", description: SITE.hero_subtitle, type: "website" },
};

export default async function Home() {
  const currency = await currentCurrency();
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      priceCents: products.priceCents,
      imageMime: products.imageMime,
    })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(desc(products.createdAt))
    .limit(8);
  const featured = await inCurrency(rows, currency);
  return (
    <ShopShell cartCount={await cartCount()} back="/">
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by the GEO helpers, "<" escaped */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd(SITE.faq) }}
      />
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by the GEO helpers, "<" escaped */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: websiteJsonLd("__APP_NAME__", env.BETTER_AUTH_URL, SITE.hero_subtitle),
        }}
      />
      <section className="bg-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 py-20 text-center">
          <h1 className="text-5xl font-bold tracking-tight">{SITE.tagline}</h1>
          <p className="text-lg text-slate-600">{SITE.hero_subtitle}</p>
          <Link
            href="/shop"
            className="rounded-md bg-brand px-6 py-3 font-medium text-brand-contrast"
          >
            {SITE.cta}
          </Link>
        </div>
      </section>
      <section aria-labelledby="new" className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="new" className="mb-8 text-3xl font-semibold">
          New in
        </h2>
        {featured.length === 0 ? <p className="text-slate-600">Products are coming soon.</p> : null}
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {featured.map((p) => (
            <ProductCard key={p.id} p={p} currency={currency} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="faq" className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 id="faq" className="mb-8 text-3xl font-semibold">
            Frequently asked questions
          </h2>
          <div className="flex flex-col gap-3">
            {SITE.faq.map((f) => (
              <details key={f.q} className="rounded-lg border border-slate-200 p-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </ShopShell>
  );
}
