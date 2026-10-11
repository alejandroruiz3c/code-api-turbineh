import type { MetadataRoute } from "next";
import { env } from "@/env";

/** Public pages only; the admin area is never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${env.BETTER_AUTH_URL}/`, changeFrequency: "weekly", priority: 1 }];
}
