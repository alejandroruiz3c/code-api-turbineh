import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Services — __APP_NAME__",
  alternates: { canonical: "/services" },
};

export default async function Services() {
  const site = await getSite();
  return (
    <SiteShell cta={site.cta}>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="mb-8 text-4xl font-bold">Services</h1>
        <div className="flex flex-col gap-6">
          {site.services.map((s) => (
            <article key={s.title} className="rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="mb-2 text-xl font-semibold">{s.title}</h2>
              <p className="text-slate-600">{s.text}</p>
            </article>
          ))}
        </div>
        <Link
          href="/contact"
          className="mt-10 inline-block rounded-md bg-brand px-6 py-3 font-medium text-brand-contrast"
        >
          {site.cta}
        </Link>
      </section>
    </SiteShell>
  );
}
