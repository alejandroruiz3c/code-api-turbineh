import { eq } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { env } from "@/env";

export const dynamic = "force-dynamic";

/** Public pages and visible products; cart, checkout and admin are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const rows = await db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.active, true));
  return [
    { url: `${base}/`, changeFrequency: "daily" },
    { url: `${base}/shop`, changeFrequency: "daily" },
    ...rows.map((p) => ({ url: `${base}/shop/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
