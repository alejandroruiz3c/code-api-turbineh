import { NextResponse } from "next/server";
import { recordingConfig as cfg, sizeLabel } from "@/recordings/config";
import { readLimited } from "@/recordings/media";
import { saveRecording } from "@/recordings/service";
import { toUserMessage, UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";

/**
 * POST /api/recordings — stores a finished recording (component media.screen-recording.turbineh). Body: the video
 * bytes (WebM or MP4, recognised by content); query: title, durationMs, width, height, requestedWidth,
 * requestedHeight, frameRate, layout. Signed-in member of the workspace, rate-limited, size-limited while reading.
 */
export async function POST(req: Request): Promise<Response> {
  const ctx = await requireMember();
  if (!(await rateLimit(`recordings:${ctx.userId}`, 20)))
    return NextResponse.json(
      { error: "Too many uploads. Try again in a minute." },
      { status: 429 },
    );
  const declared = Number(req.headers.get("content-length") ?? "0");
  const tooLarge = `Recordings are limited to ${sizeLabel(cfg.maxBytes)}.`;
  if (declared > cfg.maxBytes) return NextResponse.json({ error: tooLarge }, { status: 413 });
  const bytes = await readLimited(req.body, cfg.maxBytes);
  if (!bytes) return NextResponse.json({ error: tooLarge }, { status: 413 });
  const q = new URL(req.url).searchParams;
  const num = (k: string) => Number.parseInt(q.get(k) ?? "", 10);
  try {
    const id = await saveRecording(ctx, bytes, {
      title: (q.get("title") ?? "").slice(0, 200),
      durationMs: num("durationMs"),
      width: num("width"),
      height: num("height"),
      requestedWidth: num("requestedWidth"),
      requestedHeight: num("requestedHeight"),
      frameRate: num("frameRate"),
      layout: q.get("layout") ?? "",
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof UserFacingError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
