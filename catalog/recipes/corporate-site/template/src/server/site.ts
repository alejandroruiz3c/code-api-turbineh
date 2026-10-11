import { eq } from "drizzle-orm";
import { z } from "zod";
import { SITE } from "@/content/site";
import { db } from "@/db/client";
import { siteSettings } from "@/db/schema";

const item = z.object({
  title: z.string().trim().min(2).max(60),
  text: z.string().trim().min(2).max(240),
});

/** What the admin may edit; everything is plain text (rendered escaped). */
export const siteSchema = z.object({
  tagline: z.string().trim().min(3).max(90),
  hero_subtitle: z.string().trim().min(5).max(240),
  about: z.string().trim().min(10).max(1200),
  cta: z.string().trim().min(2).max(40),
  services: z.array(item).min(1).max(8),
  features: z.array(item).min(1).max(8),
  faq: z
    .array(z.object({ q: z.string().trim().min(3).max(160), a: z.string().trim().min(3).max(500) }))
    .min(1)
    .max(10),
});
export type Site = z.infer<typeof siteSchema>;

/** Current website texts: the admin's saved version if valid, otherwise the delivered defaults. */
export async function getSite(): Promise<Site> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1));
  const saved = row ? siteSchema.safeParse(row.content) : null;
  return saved?.success ? saved.data : siteSchema.parse(SITE);
}
