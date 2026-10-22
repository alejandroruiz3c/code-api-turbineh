import { z } from "zod";
import { videoResponse } from "@/recordings/serve";
import { getRecording } from "@/recordings/service";
import { requireMember } from "@/server/authz";

/**
 * GET /dashboard/recordings/<id>/media — the video of a recording of the member's workspace, with Range support
 * (seeking). Anything else is a 404 (no hint whether it exists).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const member = await requireMember();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const row = await getRecording(member, id);
  if (!row) return new Response("Not found", { status: 404 });
  return videoResponse(req, row);
}
