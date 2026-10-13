import { z } from "zod";
import { UserFacingError } from "@/security/errors";
import { requireMember } from "@/server/authz";
import { readUpload } from "@/uploads/service";
import { attachmentHeader } from "@/uploads/sniff";

/**
 * GET /dashboard/files/<id>/download — the only way to read a stored file: signed-in member of the workspace who may
 * see the file's record scope (src/server/record-access.ts). Always an attachment, never rendered inline; anything
 * else is a 404 (no hint whether the file exists).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const member = await requireMember();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  try {
    const { row, bytes } = await readUpload(member, id);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": attachmentHeader(row.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UserFacingError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
