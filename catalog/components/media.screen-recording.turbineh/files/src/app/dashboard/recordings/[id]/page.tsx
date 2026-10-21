import { notFound } from "next/navigation";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import {
  durationLabel,
  LAYOUT_LABELS,
  recordingConfig,
  sizeLabel,
  type LayoutKey,
} from "@/recordings/config";
import { getRecording } from "@/recordings/service";
import { requireMember } from "@/server/authz";
import { DeleteForm, RenameForm, ShareForm } from "./forms";

export const dynamic = "force-dynamic";

/** One recording: player (seekable), what was asked and recorded, rename, share link, delete. */
export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await getRecording(ctx, id);
  if (!r) notFound();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{r.title}</h1>
      <video
        data-testid="player"
        className="w-full rounded-lg border border-line bg-subtle"
        src={`/dashboard/recordings/${r.id}/media`}
        controls
        playsInline
        preload="metadata"
      />
      <Card title="Details">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Recorded at</dt>
          <dd data-testid="recorded-resolution">
            {r.width}×{r.height}
          </dd>
          <dt className="text-muted">Asked for</dt>
          <dd>
            {r.requestedWidth}×{r.requestedHeight} at {r.frameRate} fps
          </dd>
          <dt className="text-muted">Layout</dt>
          <dd>{LAYOUT_LABELS[r.layout as LayoutKey] ?? r.layout}</dd>
          <dt className="text-muted">Duration</dt>
          <dd>{durationLabel(r.durationMs)}</dd>
          <dt className="text-muted">Size</dt>
          <dd>
            {sizeLabel(r.size)} ({r.container.toUpperCase()})
          </dd>
        </dl>
      </Card>
      <Card title="Rename">
        <RenameForm id={r.id} title={r.title} />
      </Card>
      {recordingConfig.shareLinks ? (
        <Card title="Share">
          <ShareForm id={r.id} shared={r.shareTokenHash !== null} />
        </Card>
      ) : null}
      <Card title="Delete">
        <DeleteForm id={r.id} />
      </Card>
    </div>
  );
}
