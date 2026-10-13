import type { ReactNode } from "react";
import { SiteShell } from "@/components/site-shell";
import { getSite } from "@/server/site";

/** Frame of the public collection pages on the corporate site (site.public-pages.turbineh): the site's own shell. */
export async function SitePagesFrame({ children }: { children: ReactNode }) {
  const site = await getSite();
  return <SiteShell cta={site.cta}>{children}</SiteShell>;
}
