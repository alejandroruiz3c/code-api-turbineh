import { productError } from "@turbineh/engine";
import { ownedFlow, productProblem, requireCaller } from "@/server/product";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * GET /v1/plans/{id}/package — download the capability package (ZIP), or `?format=manifest` for manifest.json.
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
  const key =
    new URL(req.url).searchParams.get("format") === "manifest" ? pkg?.manifestKey : pkg?.zipKey;
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
  return Response.redirect(await storage.url(key), 302);
}
