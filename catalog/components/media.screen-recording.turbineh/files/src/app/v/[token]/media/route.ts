import { headers } from "next/headers";
import { videoResponse } from "@/recordings/serve";
import { recordingByToken } from "@/recordings/service";
import { clientIp } from "@/security/client-ip";
import { rateLimit } from "@/security/rate-limit";

/**
 * GET /v/<token>/media — the video of a shared recording, for anyone holding the link (no account), with Range
 * support. Revoked or unknown links are a 404; requests are rate-limited per address (seeking makes many).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const ip = clientIp(await headers());
  if (!(await rateLimit(`recordings:shared:${ip}`, 600)))
    return new Response("Too many requests", { status: 429 });
  const { token } = await ctx.params;
  const row = await recordingByToken(token);
  if (!row) return new Response("Not found", { status: 404 });
  return videoResponse(req, row);
}
