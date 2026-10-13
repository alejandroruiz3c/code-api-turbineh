import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { getSite } from "@/server/site";
import { ContactForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Contact — __APP_NAME__",
  alternates: { canonical: "/contact" },
};

/** Public contact page with the contact form. */
export default async function Contact() {
  const site = await getSite();
  return (
    <SiteShell cta={site.cta}>
      <section className="mx-auto grid max-w-5xl gap-12 px-6 py-16 md:grid-cols-2">
        <div>
          <h1 className="mb-4 text-4xl font-bold">Contact us</h1>
          <p className="text-muted">{site.hero_subtitle}</p>
        </div>
        <ContactForm />
      </section>
    </SiteShell>
  );
}
