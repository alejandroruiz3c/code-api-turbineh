import { summarizeUseCase, USE_CASES } from "@turbineh/engine";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Catalogue · YES IF for Builders",
  description:
    "Complete flows in the TurbineH catalogue: verified apps to start from, or capabilities added to your project.",
};

/**
 * Catalogue: every complete flow (catalog/recipes, through the engine), to browse. Discover stays the search by need
 * across flows and components; an old /catalog?q= link still lands on that search.
 */
export default async function Catalog({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q;
  if (q) redirect(`/discover?q=${encodeURIComponent(q)}`);
  const flows = USE_CASES.map((u) => ({ ...summarizeUseCase(u), sections: u.sections }));
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Catalogue</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">What you can build</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Complete flows in the catalogue. Each one is a verified app you can start from, or a
        capability added to your project. The same list answers <Code>turbineh search</Code> and{" "}
        <Code>/v1/capabilities</Code>.
      </p>
      <p className="mt-3 text-sm text-muted">
        Looking for something narrower?{" "}
        <Link href="/discover" className="text-teal underline-offset-4 hover:underline">
          Discover
        </Link>{" "}
        searches flows and single verified components by what you need.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {flows.map((u) => (
          <li key={u.id} className="flex flex-col rounded-xl border border-line bg-panel/30 p-5">
            <h2 className="display text-lg font-semibold text-cream">{u.name}</h2>
            <p className="mt-1 text-sm text-muted">{u.summary}</p>
            {u.sections.length > 0 && (
              <ul aria-label={`Inside ${u.name}`} className="mt-3 flex flex-wrap gap-1.5">
                {u.sections.map((s) => (
                  <li
                    key={s}
                    className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ice-2"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ice-2">
              You provide:{" "}
              {u.requirements.map((r, i) => (
                <span key={r.name}>
                  {i ? " · " : ""}
                  <code className="font-mono text-teal">{r.name}</code>
                </span>
              ))}
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-5 text-sm">
              <Link
                href={`/flows/new?capability=${encodeURIComponent(u.id)}&need=${encodeURIComponent(u.summary)}`}
                className="rounded-full bg-amber px-4 py-1.5 font-semibold text-navy"
              >
                Start this flow
              </Link>
              <Link
                href={`/discover?q=${encodeURIComponent(u.name)}`}
                className="rounded-full border border-line px-4 py-1.5 text-ice-2 hover:border-teal"
              >
                Related components
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-[12.5px] text-teal">{children}</code>
);
