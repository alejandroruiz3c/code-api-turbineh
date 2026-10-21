import type { ReactNode } from "react";
import { SiteShell } from "@/components/site-shell";
import { getSite } from "@/server/site";

/** The blog inside the corporate website: the site's own header, menu, call to action and footer. */
export async function BlogShell({ children }: { children: ReactNode }) {
  const site = await getSite();
  return <SiteShell cta={site.cta}>{children}</SiteShell>;
}
