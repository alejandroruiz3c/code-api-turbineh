import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { listPublished } from "@/blog/posts";
import { faqJsonLd, websiteJsonLd } from "@/lib/geo";
import { absolute, jsonLd } from "@/lib/seo";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return {
    title: `__APP_NAME__ — ${site.tagline}`,
    description: site.hero_subtitle,
    alternates: { canonical: "/" },
    openGraph: {
      title: "__APP_NAME__",
      description: site.hero_subtitle,
      type: "website",
      url: absolute("/"),
    },
  };
}

/** Public home page: hero, services, steps, FAQ and call to action (copy in src/content/site.ts). */
export default async function Home() {
  const site = await getSite();
  const { posts: latest } = await listPublished({ limit: 3 });
  const org = jsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "__APP_NAME__",
    url: absolute("/"),
    description: site.hero_subtitle,
  });
  return (
    <SiteShell cta={site.cta}>
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by jsonLd(), "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: org }} />
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by the GEO helpers, "<" escaped */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd(site.faq) }}
      />
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by the GEO helpers, "<" escaped */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: websiteJsonLd("__APP_NAME__", absolute("/"), site.hero_subtitle),
        }}
      />
      <section className="bg-panel">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-24 text-center">
          <h1 className="text-5xl font-bold tracking-tight">{site.tagline}</h1>
          <p className="text-lg text-muted">{site.hero_subtitle}</p>
          <div className="flex gap-3">
            <Link
              href="/contact"
              className="rounded-md bg-brand px-6 py-3 font-medium text-brand-contrast"
            >
              {site.cta}
            </Link>
            <Link href="/services" className="rounded-md border border-field px-6 py-3">
              Our services
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="services" className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="services" className="mb-8 text-3xl font-semibold">
          What we do
        </h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {site.services.map((s) => (
            <li key={s.title} className="rounded-lg border border-line bg-panel p-6">
              <h3 className="mb-2 font-semibold">{s.title}</h3>
              <p className="text-muted">{s.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="why" className="bg-panel py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 id="why" className="mb-8 text-3xl font-semibold">
            Why choose us
          </h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {site.features.map((f) => (
              <li key={f.title}>
                <h3 className="mb-1 font-semibold">{f.title}</h3>
                <p className="text-muted">{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {latest.length > 0 ? (
        <section aria-labelledby="news" className="mx-auto max-w-6xl px-6 py-16">
          <h2 id="news" className="mb-8 text-3xl font-semibold">
            Latest from the blog
          </h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {latest.map((p) => (
              <li key={p.slug} className="rounded-lg border border-line bg-panel p-6">
                <h3 className="mb-2 font-semibold">
                  <Link href={`/blog/${p.slug}`} className="hover:underline">
                    {p.title}
                  </Link>
                </h3>
                <p className="text-muted">{p.excerpt}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="faq" className="bg-panel py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 id="faq" className="mb-8 text-3xl font-semibold">
            Frequently asked questions
          </h2>
          <div className="flex flex-col gap-3">
            {site.faq.map((f) => (
              <details key={f.q} className="rounded-lg border border-line p-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
