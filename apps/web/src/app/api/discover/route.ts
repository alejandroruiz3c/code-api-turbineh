import { searchCapabilities } from "@turbineh/engine";
import { getCaller } from "@/server/caller";
import { catalog } from "@/server/product";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover?q= — fallback of Discover while `/v1/capabilities` is unavailable: the same ranking (one
 * function, ADR-0066: minimum similarity, rerank by capability description, precision@5 measured in CI).
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await getCaller())) return problem(401, "Open the product with your access first");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 300);
  const results = searchCapabilities(q, await catalog(), { limit: 20 });
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
