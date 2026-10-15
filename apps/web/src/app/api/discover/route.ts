import type { CapabilitySummary } from "@turbineh/shared";
import { matchUseCases } from "@/lib/use-cases";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { problem } from "@/server/problem";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover?q= — product-area search by need: complete use cases first, then verified components that bring
 * the capability. Same shape as the engine's `/v1/capabilities` (PLAN §16.4), used until that endpoint is live.
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await getCaller())) return problem(401, "Open the product with your access first");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const useCases: CapabilitySummary[] = matchUseCases(q).map((u) => ({
    id: u.id,
    kind: u.kind,
    name: u.name,
    summary: u.summary,
    components: u.components,
    stacks: u.stacks,
    requirements: u.requirements,
    example: u.example,
  }));
  const terms = q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);
  const { rows } = await db.query<{
    id: string;
    category: string;
    provides: string[];
    license: string;
    does: string | null;
    purl: string;
  }>(
    `SELECT id, category, provides, license, purl, manifest->'capability'->>'does' AS does
     FROM components WHERE status = 'approved'
       AND (cardinality($1::text[]) = 0 OR EXISTS (
         SELECT 1 FROM unnest($1::text[]) t
         WHERE id ILIKE '%' || t || '%' OR manifest->'capability'->>'does' ILIKE '%' || t || '%'))
     ORDER BY category, id LIMIT 40`,
    [terms],
  );
  const components: CapabilitySummary[] = rows.map((r) => ({
    id: r.id,
    kind: "component",
    name: r.id,
    summary: r.does ?? "",
    components: 1,
    stacks: ["TypeScript"],
    requirements: [],
    example: `Contract test in the sandbox · ${r.license} · ${r.purl.replace(/^pkg:(npm|generic)\//, "")}`,
  }));
  return Response.json(
    { results: [...useCases, ...components] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
