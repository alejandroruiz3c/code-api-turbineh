import { db } from "@/server/db";
import { problem } from "@/server/problem";
import { requireCaller } from "@/server/product";

/** GET /v1/components/{id} — full manifest (access token or API key). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const res = await db.query("SELECT manifest FROM components WHERE id = $1", [id.slice(0, 120)]);
  return res.rows[0] ? Response.json(res.rows[0].manifest) : problem(404, "Component not found");
}
