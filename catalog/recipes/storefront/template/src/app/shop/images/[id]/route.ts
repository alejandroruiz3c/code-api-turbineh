import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { products } from "@/db/schema";

/** Product image (type checked on upload); cached by browsers and CDNs. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [p] = await db
    .select({ image: products.image, mime: products.imageMime })
    .from(products)
    .where(and(eq(products.id, id), eq(products.active, true)));
  if (!p?.image || !p.mime) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.image), {
    headers: {
      "Content-Type": p.mime,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
