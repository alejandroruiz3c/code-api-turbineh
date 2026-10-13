import { searchCapabilities } from "@turbineh/engine";
import { catalog, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

/**
 * GET /v1/capabilities?q=<need>&limit= — search by need (PLAN §16 "Descubrir"): complete use cases first, then the
 * verified components that cover the need, each with requirements and what its runnable example shows.
 */
export async function GET(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 300);
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const all = await catalog();
  const results = searchCapabilities(q, all, { limit });
  return Response.json(
    { query: q, total: { components: all.length }, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
