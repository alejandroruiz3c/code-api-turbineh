import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "About — __APP_NAME__",
  alternates: { canonical: "/about" },
};

export default async function About() {
  const site = await getSite();
  return (
    <SiteShell cta={site.cta}>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-6 text-4xl font-bold">About __APP_NAME__</h1>
        <p className="text-lg whitespace-pre-line text-muted">{site.about}</p>
        <h2 className="mt-12 mb-6 text-2xl font-semibold">What we value</h2>
        <ul className="grid gap-6 md:grid-cols-2">
          {site.features.map((f) => (
            <li key={f.title}>
              <h3 className="mb-1 font-semibold">{f.title}</h3>
              <p className="text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}
