import { db } from "@/server/db";
import { problem } from "@/server/problem";

/** GET /v1/components/{id} — full manifest. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const res = await db.query("SELECT manifest FROM components WHERE id = $1", [id.slice(0, 120)]);
  return res.rows[0] ? Response.json(res.rows[0].manifest) : problem(404, "Component not found");
}
