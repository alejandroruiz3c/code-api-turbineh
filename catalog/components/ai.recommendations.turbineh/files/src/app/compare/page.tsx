import { z } from "zod";
import { recommendationConfig as cfg } from "@/recommendations/config";
import { compareRows, REFERENCE } from "@/recommendations/search";
import { publishedByReference } from "@/recommendations/store";

export const dynamic = "force-dynamic";

const Refs = z
  .string()
  .max(120)
  .transform((s) =>
    s
      .split(",")
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(REFERENCE)).min(2).max(4));

/** Public side-by-side comparison of 2–4 verified records (/compare?refs=A,B), straight from the database. */
export default async function Compare({
  searchParams,
}: {
  searchParams: Promise<{ refs?: string | string[] }>;
}) {
  const raw = (await searchParams).refs;
  const refs = Refs.safeParse(Array.isArray(raw) ? raw.join(",") : (raw ?? ""));
  const found = refs.success ? await publishedByReference(refs.data) : null;
  const table = found && found.items.length >= 2 ? compareRows(found.items, cfg) : null;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">Compare {cfg.item.plural}</h1>
      {table ? (
        <table className="w-full border-collapse text-left text-sm" aria-label="Comparison">
          <thead>
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium text-muted" />
              {table.head.map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.label} className="border-b border-line">
                <th scope="row" className="px-3 py-2 font-medium text-muted">
                  {r.label}
                </th>
                {r.values.map((v, i) => (
                  <td key={i} className="px-3 py-2">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p role="status" className="text-muted">
          Choose two to four published {cfg.item.plural} by reference to compare them.
        </p>
      )}
      {found && found.unknown.length > 0 ? (
        <p className="text-sm text-muted">Not found: {found.unknown.join(", ")}.</p>
      ) : null}
    </main>
  );
}
