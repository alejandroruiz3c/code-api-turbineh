import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePagesFrame } from "@/components/site-pages/frame";
import { collectionOf, sitePagesConfig } from "@/site-pages/config";
import { safeImageUrl } from "@/site-pages/rules";
import { absoluteUrl, publishedEntry } from "@/site-pages/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ collection: string; slug: string }> };

async function load(params: Props["params"]) {
  const { collection, slug } = await params;
  const c = collectionOf(collection);
  if (!c || !c.detail) return null;
  const e = await publishedEntry(c, slug);
  return e ? { c, e } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load(params);
  if (!r) return { title: "Not found" };
  const path = `${r.c.path}/${r.e.slug}`;
  return sitePagesConfig.seo
    ? {
        title: r.e.title,
        description: r.e.summary || `${r.c.label} — __APP_NAME__`,
        alternates: { canonical: path },
        // The Open Graph image is generated next to this page (opengraph-image.tsx).
        openGraph: {
          title: r.e.title,
          description: r.e.summary,
          type: "article",
          url: absoluteUrl(path),
        },
      }
    : { title: r.e.title };
}

/** One published entry of a collection (site.public-pages.turbineh), e.g. a portfolio project or an open position. */
export default async function EntryPage({ params }: Props) {
  const r = await load(params);
  if (!r) notFound();
  const { c, e } = r;
  const img = safeImageUrl(e.imageUrl);
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type":
      c.entity === "JobPosition" || /job|position|vacanc/i.test(c.entity)
        ? "JobPosting"
        : "CreativeWork",
    name: e.title,
    title: e.title,
    description: e.summary || e.title,
    url: absoluteUrl(`${c.path}/${e.slug}`),
    datePosted: e.createdAt.toISOString(),
  }).replace(/</g, "\\u003c");
  return (
    <SitePagesFrame>
      {sitePagesConfig.seo ? (
        // nosemgrep: turbineh.unsanitized-html -- JSON-LD from JSON.stringify with "<" escaped
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      ) : null}
      <article className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
        <Link href={c.path} className="text-sm text-accent underline">
          ← {c.plural}
        </Link>
        <h1 className="text-4xl font-bold">{e.title}</h1>
        {e.summary ? <p className="text-lg text-muted">{e.summary}</p> : null}
        <p className="flex flex-wrap gap-2 text-xs">
          {c.filters
            .filter((f) => e.attributes[f.key])
            .map((f) => (
              <span key={f.key} className="rounded bg-subtle px-2 py-0.5">
                {f.label}: {e.attributes[f.key]}
              </span>
            ))}
        </p>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote image URL, no optimizer
          <img src={img} alt="" className="w-full rounded-lg" />
        ) : null}
        <div className="whitespace-pre-wrap">{e.body}</div>
      </article>
    </SitePagesFrame>
  );
}
