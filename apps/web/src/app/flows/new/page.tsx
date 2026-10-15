import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowWizard } from "@/components/flow-wizard";

export const metadata: Metadata = { title: "New flow · YES IF for Builders" };

export default async function NewFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string; capability?: string }>;
}) {
  const { need = "", capability } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">New flow</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        From need to a verified app
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Describe it, choose a new complete app or your own project, review one plan. We assemble
        verified components, write only the glue and check everything before you take it.
      </p>
      <div className="mt-8">
        <Suspense>
          <FlowWizard need={need.slice(0, 2000)} capability={capability?.slice(0, 80) ?? null} />
        </Suspense>
      </div>
    </main>
  );
}
