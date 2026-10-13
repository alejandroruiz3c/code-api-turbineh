import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/brand";
import { SITE } from "@/content/site";
import { env } from "@/env";
import { faqJsonLd, websiteJsonLd } from "@/lib/geo";
import { WaitlistForm } from "./waitlist/form";

export const metadata: Metadata = {
  title: `__APP_NAME__ — ${SITE.tagline}`,
  description: SITE.hero_subtitle,
  alternates: { canonical: "/" },
  openGraph: {
    title: "__APP_NAME__",
    description: SITE.hero_subtitle,
    type: "website",
    url: env.BETTER_AUTH_URL,
  },
  twitter: { card: "summary", title: "__APP_NAME__", description: SITE.hero_subtitle },
};

/** JSON-LD for search engines; "<" is escaped so the data can never close the script tag. */
const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "__APP_NAME__",
  url: env.BETTER_AUTH_URL,
  description: SITE.hero_subtitle,
}).replace(/</g, "\\u003c");

export default function Home() {
  return (
    <>
      {/* nosemgrep: turbineh.unsanitized-html -- static JSON-LD built from our own constants, "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
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
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2 font-semibold">
          {BRAND.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
            <img src={BRAND.logo} alt="" className="h-8 w-auto" />
          ) : null}
          __APP_NAME__
        </span>
        <a
          href="#join"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
        >
          {SITE.cta}
        </a>
      </header>

      <main>
        <section
          id="join"
          className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-20 text-center"
        >
          {BRAND.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
            <img src={BRAND.logo} alt="" className="h-20 w-auto" />
          ) : null}
          <h1 className="text-5xl font-bold tracking-tight">__APP_NAME__</h1>
          <p className="text-2xl font-medium text-ink">{SITE.tagline}</p>
          <p className="text-lg text-muted">{SITE.hero_subtitle}</p>
          <WaitlistForm />
        </section>

        <section aria-labelledby="features" className="bg-panel py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 id="features" className="mb-8 text-center text-3xl font-semibold">
              Why __APP_NAME__
            </h2>
            <ul className="grid gap-6 md:grid-cols-3">
              {SITE.features.map((f) => (
                <li key={f.title} className="rounded-lg border border-line p-6">
                  <h3 className="mb-2 font-semibold">{f.title}</h3>
                  <p className="text-muted">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="how" className="py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 id="how" className="mb-8 text-center text-3xl font-semibold">
              How it works
            </h2>
            <ol className="grid gap-6 md:grid-cols-3">
              {SITE.steps.map((s, i) => (
                <li key={s.title} className="rounded-lg bg-panel p-6 shadow-sm">
                  <span className="text-sm font-semibold text-brand">Step {i + 1}</span>
                  <h3 className="mt-1 mb-2 font-semibold">{s.title}</h3>
                  <p className="text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="faq" className="bg-panel py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 id="faq" className="mb-8 text-center text-3xl font-semibold">
              Frequently asked questions
            </h2>
            <div className="flex flex-col gap-3">
              {SITE.faq.map((f) => (
                <details key={f.q} className="rounded-lg border border-line p-4">
                  <summary className="cursor-pointer font-medium">{f.q}</summary>
                  <p className="mt-2 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 text-center">
          <h2 className="mb-4 text-3xl font-semibold">{SITE.tagline}</h2>
          <a
            href="#join"
            className="inline-block rounded-md bg-brand px-6 py-3 font-medium text-brand-contrast"
          >
            {SITE.cta}
          </a>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        © __APP_NAME__ ·{" "}
        <Link className="underline" href="/sign-in">
          Admin sign-in
        </Link>
      </footer>
    </>
  );
}
