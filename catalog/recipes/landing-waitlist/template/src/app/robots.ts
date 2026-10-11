import type { MetadataRoute } from "next";
import { env } from "@/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/dashboard", "/api", "/sign-in", "/sign-up"] },
    ],
    sitemap: `${env.BETTER_AUTH_URL}/sitemap.xml`,
  };
}
