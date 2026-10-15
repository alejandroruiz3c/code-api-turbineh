import type { MetadataRoute } from "next";
import { env } from "@/env";
import { robotsRules } from "@/lib/geo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: robotsRules(["/dashboard", "/api", "/cart", "/checkout", "/sign-in", "/sign-up"]),
    sitemap: `${env.BETTER_AUTH_URL}/sitemap.xml`,
  };
}
