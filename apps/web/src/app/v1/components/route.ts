import { db } from "@/server/db";
import { requireCaller } from "@/server/product";

/** GET /v1/components?q=&category=&status= — catalog search (access token or API key). */
export async function GET(req: Request): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 100);
  const category = u.searchParams.get("category");
  const status = u.searchParams.get("status") ?? "approved";
  const res = await db.query(
    `SELECT id, version, status, category, provides, purl, license, manifest->'capability'->>'does' AS does
     FROM components
     WHERE status = $1 AND ($2::text IS NULL OR category = $2)
       AND ($3 = '' OR id ILIKE '%' || $3 || '%' OR manifest->'capability'->>'does' ILIKE '%' || $3 || '%')
     ORDER BY category, id LIMIT 200`,
    [status, category, q],
  );
  return Response.json({ components: res.rows });
}
