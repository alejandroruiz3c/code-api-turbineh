import { desc, eq } from "drizzle-orm";
import { SITE } from "@/content/site";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { env } from "@/env";
import { line } from "@/lib/geo";
import { formatPrice } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** /llms.txt — the shop and its products (name, price, availability) for AI assistants and answer engines. */
export async function GET(): Promise<Response> {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(desc(products.createdAt))
    .limit(100);
  const body = [
    "# __APP_NAME__",
    "",
    `> ${line(SITE.hero_subtitle)}`,
    "",
    "## Products",
    ...rows.map(
      (p) =>
        `- [${line(p.name, 120)}](${base}/shop/${p.slug}): ${formatPrice(p.priceCents, env.SHOP_CURRENCY)}, ${p.stock === null || p.stock > 0 ? "in stock" : "out of stock"} — ${line(p.description, 200)}`,
    ),
    "",
    "## FAQ",
    ...SITE.faq.flatMap((f) => [`- Q: ${line(f.q, 160)}`, `  A: ${line(f.a, 500)}`]),
    "",
    "## Buying",
    "- Payments are processed securely by Stripe Checkout.",
  ].join("\n");
  return new Response(`${body}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
