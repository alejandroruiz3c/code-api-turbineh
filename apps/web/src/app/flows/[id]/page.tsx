import { getBuild } from "@turbineh/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { EngineFlow } from "@/components/engine-flow";
import { FlowView } from "@/components/flow-view";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Flow · YES IF for Builders" };

const UUID = /^[0-9a-f-]{36}$/;
const ENGINE_ID = /^[A-Za-z0-9_-]{4,80}$/;

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCaller();
  if (!caller) redirect(`/access?next=/flows/${encodeURIComponent(id)}`);
  if (!UUID.test(id)) {
    // Flows run by the product engine (plan ids) are loaded from /v1/plans/{id}.
    if (!ENGINE_ID.test(id)) notFound();
    return (
      <main className="mx-auto max-w-6xl px-6 pt-8">
        <p className="eyebrow">Flow</p>
        <div className="mt-6">
          <EngineFlow id={id} />
        </div>
      </main>
    );
  }
  const build = await getBuild(db, id, caller.ownerId);
  if (!build) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Flow</p>
      <h1 className="display mt-2 max-w-3xl text-2xl font-semibold text-cream">{build.prompt}</h1>
      <div className="mt-6">
        <Suspense>
          <FlowView id={id} />
        </Suspense>
      </div>
    </main>
  );
}
