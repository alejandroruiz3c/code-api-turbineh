import { productError } from "@turbineh/engine";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * GET /v1/plans/{id}/package — download the capability package (ZIP), `?format=manifest` for manifest.json, or
 * `?format=app` for the complete verified application (what `turbineh build` writes into an empty folder).
 * Redirects to a short-lived signed URL.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const row = await ownedFlow(caller, id);
  if (row instanceof Response) return row;
  const pkg = row.artifact?.package as { zipKey?: string; manifestKey?: string } | undefined;
  const format = new URL(req.url).searchParams.get("format");
  // `format=app`: the complete verified application (ZIP of the delivered repository), for a new project.
  const key =
    format === "manifest"
      ? pkg?.manifestKey
      : format === "app"
        ? (row.artifact?.zipKey as string | undefined)
        : pkg?.zipKey;
  if (!key) {
    return productProblem(
      409,
      productError(
        "package_not_ready",
        "The package is not generated yet.",
        `Generate it first (POST /v1/plans/${id}/generate) and wait for the state \`verified\`.`,
        `turbineh apply ${id}`,
      ),
    );
  }
  const url = await storage.url(key);
  // Local storage answers with an app path behind the browser session: serve the bytes here for API callers.
  if (url.startsWith("/")) {
    const manifest = key.endsWith(".json");
    return new Response(new Uint8Array(await storage.get(key)), {
      headers: {
        "Content-Type": manifest ? "application/json" : "application/zip",
        "Cache-Control": "no-store",
        ...(manifest
          ? {}
          : {
              "Content-Disposition": `attachment; filename="${key.split("/").pop() ?? "package.zip"}"`,
            }),
      },
    });
  }
  return Response.redirect(url, 302);
}
