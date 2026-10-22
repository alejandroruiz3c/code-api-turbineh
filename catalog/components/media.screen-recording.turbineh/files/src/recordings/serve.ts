import { parseRange } from "./media";
import { readBytes, type Recording } from "./service";

/**
 * Answers a video request for an authorised recording with HTTP Range support (206 Partial Content), so players can
 * seek; inline, never cached by shared caches, never sniffed.
 */
export async function videoResponse(req: Request, row: Recording): Promise<Response> {
  const bytes = await readBytes(row);
  if (!bytes) return new Response("Not found", { status: 404 });
  const size = bytes.byteLength;
  const base = {
    "Content-Type": row.mime,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable")
    return new Response(null, {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${size}` },
    });
  if (!range)
    return new Response(Buffer.from(bytes), {
      headers: { ...base, "Content-Length": String(size) },
    });
  const part = bytes.subarray(range.start, range.end + 1);
  return new Response(Buffer.from(part), {
    status: 206,
    headers: {
      ...base,
      "Content-Length": String(part.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}
