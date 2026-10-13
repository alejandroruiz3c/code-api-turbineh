import Link from "next/link";
import type { ReactNode } from "react";
import { collections } from "@/site-pages/config";

/**
 * Frame of the public collection pages (component site.public-pages.turbineh): a simple header with the collections.
 * Recipes with their own site layout replace this file (corporate-site wraps the pages in its SiteShell).
 */
export async function SitePagesFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap gap-5 px-6 py-4 text-sm">
          <Link href="/" className="font-semibold text-accent">
            Home
          </Link>
          {collections.map((c) => (
            <Link key={c.key} href={c.path} className="hover:text-brand">
              {c.plural}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
