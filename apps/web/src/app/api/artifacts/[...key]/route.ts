import { getBuild } from "@turbineh/db";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";
import { storage } from "@/server/storage";

/** Development-only download route for the local storage driver (S3 uses signed URLs). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (process.env.STORAGE_DRIVER === "s3") return problem(404, "Not found");
  const { key } = await ctx.params;
  const caller = await getCaller();
  const buildId = key[1] ?? "";
  if (!caller || key[0] !== "builds" || !(await getBuild(db, buildId, caller.ownerId)))
    return problem(404, "Not found");
  const body = await storage.get(key.join("/"));
  const name = key[key.length - 1] ?? "artifact";
  // Screen previews are shown inline; everything else downloads.
  if (/^[\w-]+\.png$/.test(name) && key[2] === "previews") {
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": name.endsWith(".zip") ? "application/zip" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
