import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { durationLabel } from "@/recordings/config";
import { recordingByToken } from "@/recordings/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared recording — __APP_NAME__",
  robots: { index: false },
};

/** Shared recording: anyone with the link watches it, no account needed; a revoked link is a 404. */
export default async function SharedRecording({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await recordingByToken(token);
  if (!row) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 bg-surface p-6 text-ink">
      <h1 className="text-2xl font-semibold">{row.title}</h1>
      <p className="text-sm text-muted">
        {row.width}×{row.height} · {durationLabel(row.durationMs)} · shared from __APP_NAME__
      </p>
      <video
        data-testid="shared-player"
        className="w-full rounded-lg border border-line bg-subtle"
        src={`/v/${token}/media`}
        controls
        playsInline
        preload="metadata"
      />
    </main>
  );
}
