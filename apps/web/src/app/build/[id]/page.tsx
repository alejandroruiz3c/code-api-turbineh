import { getBuild } from "@turbineh/db";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { BuildLive } from "@/components/build-live";
import { db } from "@/server/db";
import { currentUser } from "@/server/session";

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const build = await getBuild(db, id, `user:${user.id}`);
  if (!build) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Build</p>
      <h1 className="display mt-2 max-w-3xl text-2xl font-semibold text-cream">{build.prompt}</h1>
      <div className="mt-8">
        <Suspense>
          <BuildLive id={id} />
        </Suspense>
      </div>
    </main>
  );
}
