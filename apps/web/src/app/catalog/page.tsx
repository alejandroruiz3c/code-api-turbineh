import Link from "next/link";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  category: string;
  provides: string[];
  purl: string;
  license: string;
  does: string;
};

export default async function Catalog({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const { rows } = await db.query<Row>(
    `SELECT id, category, provides, purl, license, manifest->'capability'->>'does' AS does
     FROM components WHERE status = 'approved'
       AND ($1 = '' OR id ILIKE '%' || $1 || '%' OR manifest->'capability'->>'does' ILIKE '%' || $1 || '%')
     ORDER BY category, id`,
    [q],
  );
  const groups = rows.reduce<Record<string, Row[]>>(
    (acc, r) => ((acc[r.category] ??= []).push(r), acc),
    {},
  );
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Catalog</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        {rows.length} approved components
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Every component is contract-tested in an isolated sandbox, licence-checked and scanned for
        known vulnerabilities before it can be assembled into an app.
      </p>
      <form className="mt-6" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search capabilities or components"
          aria-label="Search the catalog"
          className="w-full max-w-md rounded-full border border-line bg-navy-900/60 px-4 py-2 text-sm focus:border-teal focus:outline-none"
        />
      </form>
      {Object.entries(groups).map(([cat, items]) => (
        <section key={cat} className="mt-10">
          <h2 className="eyebrow mb-3 text-teal">{cat}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-panel/40 p-4">
                <Link
                  href={`/v1/components/${c.id}`}
                  className="font-mono text-xs text-ice-2 hover:text-teal"
                >
                  {c.id}
                </Link>
                <p className="mt-2 text-sm text-muted">{c.does}</p>
                <p className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
                  <span className="rounded border border-line px-1.5">{c.license}</span>
                  <span className="rounded border border-line px-1.5">
                    {c.purl.replace(/^pkg:(npm|generic)\//, "")}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
