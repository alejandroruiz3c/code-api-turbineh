import type { Metadata } from "next";
import { Discover } from "@/components/discover";

export const metadata: Metadata = { title: "Discover · YES IF for Builders" };

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").slice(0, 120);
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Discover</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">Search by what you need</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Complete flows and verified components from an audited repository that keeps growing. Every
        result shows what it brings and what you provide; each component shows a usage example
        generated from its contract test and compiled against the pinned version.
      </p>
      <div className="mt-6">
        <Discover key={q} initialQuery={q} />
      </div>
    </main>
  );
}
