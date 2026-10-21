// Server code in the app (e.g. a page or a server action): the workspace's recordings with what was really recorded,
// and a share link for the latest one.
import { listRecordings, shareRecording, type Member } from "@/recordings/service";

export async function shareLatestRecording(ctx: Member): Promise<string | null> {
  const [latest] = await listRecordings(ctx);
  if (!latest) return null;
  const token = await shareRecording(ctx, latest.id);
  return `/v/${token} (${latest.title}, recorded at ${latest.width}×${latest.height})`;
}
