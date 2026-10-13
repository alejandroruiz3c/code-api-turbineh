import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePagesFrame } from "@/components/site-pages/frame";
import { collectionOf, sitePagesConfig } from "@/site-pages/config";
import { safeImageUrl } from "@/site-pages/rules";
import { absoluteUrl, publishedEntries } from "@/site-pages/service";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ collection: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = collectionOf((await params).collection);
  if (!c) return { title: "Not found" };
  return sitePagesConfig.seo
    ? {
        title: c.plural,
        description: `${c.plural} — __APP_NAME__`,
        alternates: { canonical: c.path },
        openGraph: { title: c.plural, url: absoluteUrl(c.path), type: "website" },
      }
    : { title: c.plural };
}

/** Public list of a collection (site.public-pages.turbineh): published entries only, filterable by its fields. */
export default async function CollectionPage({ params, searchParams }: Props) {
  const c = collectionOf((await params).collection);
  if (!c) notFound();
  const q = await searchParams;
  const chosen = Object.fromEntries(c.filters.map((f) => [f.key, one(q[f.key])]));
  const { rows, options } = await publishedEntries(c, chosen);
  return (
    <SitePagesFrame>
      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-16">
        <h1 className="text-4xl font-bold">{c.plural}</h1>
        {c.filters.length ? (
          <form method="get" aria-label="Filters" className="flex flex-wrap items-end gap-3">
            {c.filters.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label htmlFor={`f-${f.key}`} className="text-sm font-medium text-muted">
                  {f.label}
                </label>
                <select
                  id={`f-${f.key}`}
                  name={f.key}
                  defaultValue={chosen[f.key]}
                  className="rounded-md border border-field px-3 py-2 text-sm"
                >
                  <option value="">All</option>
                  {(options[f.key] ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
            >
              Filter
            </button>
          </form>
        ) : null}
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="entries">
          {rows.map((r) => {
            const img = safeImageUrl(r.imageUrl);
            return (
              <li
                key={r.id}
                data-testid="entry"
                className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4"
              >
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote image URL, no optimizer
                  <img src={img} alt="" className="h-40 w-full rounded-md object-cover" />
                ) : null}
                <h2 className="text-lg font-semibold">
                  {c.detail ? <Link href={`${c.path}/${r.slug}`}>{r.title}</Link> : r.title}
                </h2>
                {r.summary ? <p className="text-sm text-muted">{r.summary}</p> : null}
                <p className="flex flex-wrap gap-2 text-xs">
                  {c.filters
                    .filter((f) => r.attributes[f.key])
                    .map((f) => (
                      <span key={f.key} className="rounded bg-subtle px-2 py-0.5">
                        {f.label}: {r.attributes[f.key]}
                      </span>
                    ))}
                </p>
                {!c.detail && r.body ? (
                  <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? <p className="text-muted">Nothing here yet.</p> : null}
      </section>
    </SitePagesFrame>
  );
}
